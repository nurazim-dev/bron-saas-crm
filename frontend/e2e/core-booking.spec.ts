import { expect, test } from '@playwright/test';

test('Core Booking: master service overrides, packages CRUD/booking, and status workflow', async ({
  page,
  browser,
}) => {
  const email = `corebook.${Date.now()}@example.test`;
  const password = 'CoreBooking123!';

  const regRes = await page.request.post('/api/v1/auth/register', {
    data: {
      companyName: 'Core Booking E2E',
      businessType: 'BARBERSHOP',
      ownerName: 'Азамат Мастер',
      email,
      password,
      termsAccepted: true,
    },
  });
  expect(regRes.status()).toBe(201);
  const { data: auth } = await regRes.json();
  const headers = { Authorization: `Bearer ${auth.accessToken}` };

  expect(
    (
      await page.request.put(`/api/v1/staff/${auth.user.id}/working-hours`, {
        headers,
        data: {
          days: Array.from({ length: 7 }, (_, idx) => ({
            dayOfWeek: idx + 1,
            startTime: '09:00',
            endTime: '22:00',
          })),
        },
      })
    ).status(),
  ).toBe(200);

  expect(
    (
      await page.request.post('/api/v1/services', {
        headers,
        data: { name: 'Стрижка', price: '500', durationMin: 30 },
      })
    ).status(),
  ).toBe(201);

  expect(
    (
      await page.request.post('/api/v1/services', {
        headers,
        data: { name: 'Борода', price: '400', durationMin: 30 },
      })
    ).status(),
  ).toBe(201);

  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  // 1. Configure per-master service price & duration override on /dashboard/staff
  await page.goto('/dashboard/staff');
  await page
    .getByRole('button', { name: /Услуги мастера/ })
    .first()
    .click();
  const staffDialog = page.getByRole('dialog');
  await expect(staffDialog).toBeVisible();

  await staffDialog.getByRole('checkbox', { name: /Стрижка/ }).check();
  await staffDialog.getByRole('checkbox', { name: /Борода/ }).check();
  await staffDialog.getByLabel('Цена для Стрижка').fill('750');
  await staffDialog.getByLabel('Длительность для Стрижка').fill('45');
  await staffDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(staffDialog).toHaveCount(0);

  await page.reload();
  await page
    .getByRole('button', { name: /Услуги мастера/ })
    .first()
    .click();
  await expect(page.getByRole('dialog').getByLabel('Цена для Стрижка')).toHaveValue('750.00');
  await expect(page.getByRole('dialog').getByLabel('Длительность для Стрижка')).toHaveValue('45');
  await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click();

  // 2. Create Service Package on /dashboard/services
  await page.goto('/dashboard/services');
  await page.getByRole('button', { name: 'Создать пакет', exact: true }).click();
  const pkgDialog = page.getByRole('dialog');
  await expect(pkgDialog).toBeVisible();
  await pkgDialog.locator('#package-name').fill('Комбо дня');
  await pkgDialog.locator('#package-price').fill('850');
  await pkgDialog.getByRole('checkbox', { name: /Стрижка/ }).check();
  await pkgDialog.getByRole('checkbox', { name: /Борода/ }).check();
  await pkgDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(pkgDialog).toHaveCount(0);
  await expect(page.getByText('Комбо дня', { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText('Комбо дня', { exact: true })).toBeVisible();
  await expect(page.getByText('850 сом')).toBeVisible();

  // 3. Public booking flow: verify override preview & book Service Package (desktop + mobile)
  const clientCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const clientPage = await clientCtx.newPage();
  clientPage.on('pageerror', (err) => errors.push(err.message));
  clientPage.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await clientPage.goto(`/b/${auth.company.slug}`);
  await expect(clientPage.getByRole('button', { name: /Комбо дня/ })).toBeVisible();

  // Check overflow & screenshot on desktop
  expect(
    await clientPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await clientPage.screenshot({
    path: '../artifacts/bron-core-booking/public-package-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });

  // Verify mobile layout zero horizontal overflow & screenshot
  await clientPage.setViewportSize({ width: 360, height: 800 });
  expect(
    await clientPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await clientPage.screenshot({
    path: '../artifacts/bron-core-booking/public-package-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });

  // Verify single service displays overridden master price (750 сом) & duration (45 мин)
  await clientPage.setViewportSize({ width: 1440, height: 900 });
  await clientPage.getByRole('button', { name: /Стрижка.*500 сом/ }).click();
  await expect(clientPage.getByText('45 мин · 750 сом')).toBeVisible();
  await clientPage.getByRole('button', { name: 'Назад', exact: true }).click();

  // Select package "Комбо дня" and complete booking
  await clientPage.getByRole('button', { name: /Комбо дня/ }).click();
  await expect(clientPage.getByText('Добавить услуги к визиту')).toHaveCount(0);
  await clientPage.getByRole('button', { name: /Азамат Мастер/ }).click();

  const slots = clientPage.getByRole('button', { name: /^\d{2}:\d{2}$/ });
  for (let i = 0; i < 4; i += 1) {
    await expect(
      slots.first().or(clientPage.getByRole('button', { name: 'Выбрать следующую дату' })),
    ).toBeVisible();
    if (await slots.count()) break;
    await clientPage.getByRole('button', { name: 'Выбрать следующую дату' }).click();
  }
  await slots.first().click();

  await expect(clientPage.getByText('850 сом').first()).toBeVisible();
  await clientPage.locator('#public-client-name').fill('Клиент комбо');
  await clientPage.locator('#public-client-phone').fill('0555 888 777');
  await clientPage.locator('#public-consent').check();
  await clientPage.getByRole('button', { name: 'Записаться', exact: true }).click();

  await expect(clientPage.getByText('Вы успешно записаны!')).toBeVisible();
  await expect(clientPage.getByText('850 сом').first()).toBeVisible();
  await clientCtx.close();

  // 4. Transition SCHEDULED -> CONFIRMED -> IN_PROGRESS in /dashboard/appointments
  await page.goto('/dashboard/appointments');
  await page.getByRole('row', { name: /Клиент комбо/ }).click();
  const detailDialog = page.getByRole('dialog');
  await expect(detailDialog).toBeVisible();

  await detailDialog.getByRole('button', { name: 'Подтвердить визит', exact: true }).click();
  await expect(detailDialog.getByText('Подтверждена', { exact: true })).toBeVisible();

  await detailDialog.getByRole('button', { name: 'Начать визит', exact: true }).click();
  await expect(detailDialog.getByText('В процессе', { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('row', { name: /Клиент комбо/ })).toContainText('В процессе');

  expect(errors).toEqual([]);
});
