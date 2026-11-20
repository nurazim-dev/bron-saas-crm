import { DateTime } from 'luxon';
import { expect, test } from '@playwright/test';

test('CRM Phase 3: tags, CSV import preview/execute, client merge preserving history, global search, and layout', async ({
  page,
}) => {
  const email = `crme2e.${Date.now()}@example.test`;
  const regRes = await page.request.post('/api/v1/auth/register', {
    data: {
      companyName: 'CRM Salon E2E',
      businessType: 'BEAUTY_SALON',
      ownerName: 'Алина Владелец',
      email,
      password: 'CrmPassword123!',
      termsAccepted: true,
    },
  });
  expect(regRes.status()).toBe(201);
  const { data: auth } = await regRes.json();
  const headers = { Authorization: `Bearer ${auth.accessToken}` };

  const svcRes = await page.request.post('/api/v1/services', {
    headers,
    data: { name: 'Укладка E2E', durationMin: 30, price: '700' },
  });
  expect(svcRes.status()).toBe(201);
  const { data: svc } = await svcRes.json();

  expect(
    (
      await page.request.put(`/api/v1/staff/${auth.user.id}/services`, {
        headers,
        data: { serviceIds: [svc.id] },
      })
    ).status(),
  ).toBe(200);

  const apptDate = DateTime.now().setZone('Asia/Bishkek').plus({ days: 2 }).toFormat('yyyy-MM-dd');
  expect(
    (
      await page.request.post('/api/v1/appointments', {
        headers,
        data: {
          masterId: auth.user.id,
          serviceId: svc.id,
          startAt: DateTime.fromISO(`${apptDate}T10:00`, { zone: 'Asia/Bishkek' }).toUTC().toISO(),
          clientName: 'Айбек Основной',
          clientPhone: '+996555200100',
        },
      })
    ).status(),
  ).toBe(201);

  expect(
    (
      await page.request.post('/api/v1/appointments', {
        headers,
        data: {
          masterId: auth.user.id,
          serviceId: svc.id,
          startAt: DateTime.fromISO(`${apptDate}T12:00`, { zone: 'Asia/Bishkek' }).toUTC().toISO(),
          clientName: 'Айбек Дубль',
          clientPhone: '+996555200101',
        },
      })
    ).status(),
  ).toBe(201);

  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard/clients');
  await expect(page.getByText('Айбек Основной', { exact: true })).toBeVisible();

  // Check desktop overflow & capture screenshot
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  // 1. Create tag "VIP" in Tags modal
  await page.getByRole('button', { name: 'Теги', exact: true }).click();
  const tagsDialog = page.getByRole('dialog');
  await expect(tagsDialog).toBeVisible();
  await tagsDialog.locator('#new-tag-name').fill('VIP');
  await tagsDialog.getByRole('button', { name: 'Создать тег', exact: true }).click();
  await expect(tagsDialog.getByText('VIP', { exact: true })).toBeVisible();
  await tagsDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(tagsDialog).toHaveCount(0);

  // 2. CSV Import preview -> execute (1 new + 1 invalid phone)
  await page.getByRole('button', { name: 'Импорт CSV', exact: true }).click();
  const importDialog = page.getByRole('dialog');
  await expect(importDialog).toBeVisible();
  await importDialog
    .locator('#import-csv-text')
    .fill('Имя;Телефон;Теги;Заметки\nДинара Импорт;0555 200 202;VIP;Утро\nПлохой Телефон;123;;');
  await importDialog.getByRole('button', { name: 'Предпросмотр импорта', exact: true }).click();
  await expect(importDialog.getByText('Создать: 1')).toBeVisible();
  await expect(importDialog.getByText('Ошибки: 1')).toBeVisible();
  await importDialog.getByRole('button', { name: 'Выполнить импорт', exact: true }).click();
  await expect(importDialog).toHaveCount(0);
  await expect(page.getByText('Динара Импорт', { exact: true })).toBeVisible();

  // Capture desktop & mobile screenshots with tags & imported client
  await page.screenshot({
    path: '../artifacts/bron-crm/clients-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });

  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: '../artifacts/bron-crm/clients-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 900 });

  // 3. Filter by tag "VIP"
  await page.getByLabel('Фильтр по тегу', { exact: true }).selectOption({ label: 'VIP' });
  await expect(page.getByText('Динара Импорт', { exact: true })).toBeVisible();
  await expect(page.getByText('Айбек Основной', { exact: true })).toHaveCount(0);
  await page.getByLabel('Фильтр по тегу', { exact: true }).selectOption('');
  await expect(page.getByText('Айбек Основной', { exact: true })).toBeVisible();

  // 4. Merge "Айбек Дубль" into "Айбек Основной" via preview -> confirm
  await page.getByRole('button', { name: 'Объединить', exact: true }).click();
  const mergeDialog = page.getByRole('dialog');
  await expect(mergeDialog).toBeVisible();
  await mergeDialog.locator('#merge-source-select').selectOption({
    label: 'Айбек Дубль (+996555200101)',
  });
  await mergeDialog.locator('#merge-target-select').selectOption({
    label: 'Айбек Основной (+996555200100)',
  });
  await mergeDialog.getByRole('button', { name: 'Предпросмотр слияния', exact: true }).click();
  await expect(mergeDialog.getByText('Перенесётся записей:')).toBeVisible();
  await mergeDialog.getByRole('button', { name: 'Подтвердить объединение', exact: true }).click();
  await expect(mergeDialog).toHaveCount(0);

  // Verify "Айбек Основной" keeps both appointments across reload
  await page.getByRole('link', { name: 'Айбек Основной', exact: true }).click();
  await expect(page.getByText('История записей (2)')).toBeVisible();
  await page.reload();
  await expect(page.getByText('История записей (2)')).toBeVisible();

  // 5. Global Search from header
  await page.getByTestId('global-search-trigger').click();
  const searchDialog = page.getByRole('dialog');
  await expect(searchDialog).toBeVisible();
  await searchDialog.locator('#global-search-input').fill('Динара');
  await expect(searchDialog.getByText('Динара Импорт', { exact: true })).toBeVisible();
  await searchDialog.getByRole('link', { name: /Динара Импорт/ }).click();
  await expect(searchDialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Динара Импорт' })).toBeVisible();

  // 6. Visit analytics page & capture CRM analytics screenshot
  await page.goto('/dashboard/analytics');
  await expect(page.getByText('Оценка по завершённым визитам')).toBeVisible();
  await page.screenshot({
    path: '../artifacts/bron-crm/analytics-crm.png',
    fullPage: true,
    animations: 'disabled',
  });

  expect(errors).toEqual([]);
});
