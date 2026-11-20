import { DateTime } from 'luxon';
import { expect, test } from '@playwright/test';

test('Multi-service: anonymous mobile booking, saved composition and staff edit', async ({
  browser,
  request,
}) => {
  const registration = await request.post('/api/v1/auth/register', {
    data: {
      companyName: 'Multi Service E2E',
      ownerName: 'Мастер комплекса',
      email: `multi.${Date.now()}@example.test`,
      password: 'Password123!',
      termsAccepted: true,
    },
  });
  expect(registration.status()).toBe(201);
  const { data: auth } = await registration.json();
  const headers = { Authorization: `Bearer ${auth.accessToken}` };
  const firstResponse = await request.post('/api/v1/services', {
    headers,
    data: { name: 'Стрижка комплекса', price: '1000', durationMin: 30 },
  });
  expect(firstResponse.status()).toBe(201);
  const { data: first } = await firstResponse.json();
  const secondResponse = await request.post('/api/v1/services', {
    headers,
    data: { name: 'Борода комплекса', price: '500', durationMin: 30 },
  });
  expect(secondResponse.status()).toBe(201);
  const { data: second } = await secondResponse.json();
  expect(
    (
      await request.put(`/api/v1/staff/${auth.user.id}/services`, {
        headers,
        data: { serviceIds: [first.id, second.id] },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.put(`/api/v1/staff/${auth.user.id}/working-hours`, {
        headers,
        data: {
          days: Array.from({ length: 7 }, (_, index) => ({
            dayOfWeek: index + 1,
            startTime: '08:00',
            endTime: '23:00',
          })),
        },
      })
    ).status(),
  ).toBe(200);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`/b/${auth.company.slug}`);
  await page.getByRole('button', { name: /Стрижка комплекса/ }).click();
  await page.getByRole('checkbox', { name: /Борода комплекса/ }).check();
  await expect(page.getByText(/Итого: 60 мин/)).toBeVisible();
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `../artifacts/bron-multiservice/selection-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Кыр', exact: true }).click();
  await expect(page.getByText('Кошумча кызматтар')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Борода комплекса/ })).toBeChecked();
  await page.screenshot({
    path: '../artifacts/bron-multiservice/selection-ky.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Рус', exact: true }).click();
  await page.getByRole('button', { name: /Любой свободный мастер/ }).click();
  const slots = page.getByRole('button', { name: /^\d{2}:\d{2}$/ });
  for (let i = 0; i < 3; i += 1) {
    await expect(
      slots.first().or(page.getByRole('button', { name: 'Выбрать следующую дату' })),
    ).toBeVisible();
    if (await slots.count()) break;
    await page.getByRole('button', { name: 'Выбрать следующую дату' }).click();
  }
  await slots.first().click();
  await page.locator('#public-client-name').fill('Клиент двух услуг');
  await page.locator('#public-client-phone').fill('0555 333 222');
  await page.locator('#public-consent').check();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await slots.first().click();
  await expect(page.locator('#public-client-name')).toHaveValue('Клиент двух услуг');
  await page.getByRole('button', { name: 'Записаться', exact: true }).click();
  await expect(page.getByText('Вы успешно записаны!')).toBeVisible();
  await expect(page.getByText('Стрижка комплекса + Борода комплекса').first()).toBeVisible();
  await page.screenshot({
    path: '../artifacts/bron-multiservice/confirmation-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  const response = await request.get('/api/v1/appointments', {
    headers,
    params: {
      from: DateTime.now().minus({ days: 1 }).toUTC().toISO() ?? '',
      to: DateTime.now().plus({ days: 30 }).toUTC().toISO() ?? '',
      limit: 200,
    },
  });
  expect(response.status()).toBe(200);
  const { data: appointments } = await response.json();
  expect(appointments).toHaveLength(1);
  expect(appointments[0].serviceIds).toEqual([first.id, second.id]);
  expect(appointments[0].price).toBe('1500.00');
  const updated = await request.patch(`/api/v1/appointments/${appointments[0].id}`, {
    headers,
    data: { internalNote: 'Проверено E2E' },
  });
  expect(updated.status()).toBe(200);
  expect((await updated.json()).data.serviceIds).toEqual([first.id, second.id]);
  const ownerContext = await browser.newContext({ storageState: await request.storageState() });
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto('/dashboard/schedule');
  const localDate = DateTime.fromISO(appointments[0].startAt)
    .setZone('Asia/Bishkek')
    .toFormat('yyyy-MM-dd');
  await ownerPage.getByLabel('Дата визита', { exact: true }).fill(localDate);
  await ownerPage.getByRole('button').filter({ hasText: 'Клиент двух услуг' }).click();
  await ownerPage.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await expect(ownerPage.getByRole('checkbox', { name: /Борода комплекса/ })).toBeChecked();
  await ownerPage.locator('#appt-internal-note').fill('Состав сохранён через форму');
  await ownerPage.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(ownerPage.getByRole('dialog')).toHaveCount(0);
  const afterEdit = await request.get(`/api/v1/appointments/${appointments[0].id}`, { headers });
  expect(afterEdit.status()).toBe(200);
  expect((await afterEdit.json()).data.serviceIds).toEqual([first.id, second.id]);
  await ownerContext.close();
  expect(errors).toEqual([]);
  await context.close();
});
