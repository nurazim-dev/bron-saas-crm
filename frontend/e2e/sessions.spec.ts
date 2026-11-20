import { expect, test } from '@playwright/test';

test('Sessions: list devices and revoke another device without ending the current session', async ({
  page,
  playwright,
}) => {
  const email = `devices.${Date.now()}@example.test`;
  const password = 'DevicesPassword123!';
  const registration = await page.request.post('/api/v1/auth/register', {
    data: {
      companyName: 'Devices Salon',
      ownerName: 'Владелец устройств',
      email,
      password,
      termsAccepted: true,
    },
  });
  expect(registration.status()).toBe(201);
  const secondClient = await playwright.request.newContext({
    baseURL: 'http://localhost:3000',
    userAgent: 'Second test device',
  });
  const login = await secondClient.post('/api/v1/auth/login', { data: { email, password } });
  expect(login.status()).toBe(200);
  const token = (await login.json()).data.accessToken;
  await page.goto('/dashboard/profile');
  await expect(page.getByText('Это устройство', { exact: true })).toBeVisible();
  await expect(page.getByText('Second test device', { exact: true })).toBeVisible();
  const other = page
    .locator('div.rounded-lg.border')
    .filter({ has: page.getByText('Second test device', { exact: true }) });
  await other.getByRole('button', { name: 'Завершить сессию', exact: true }).click();
  await other.getByRole('button', { name: 'Завершить', exact: true }).click();
  await expect(page.getByText('Second test device', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Это устройство', { exact: true })).toBeVisible();
  expect(
    (
      await secondClient.get('/api/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } })
    ).status(),
  ).toBe(401);
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `../artifacts/bron-autopilot/sessions-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
  await secondClient.dispose();
});

test('Email confirmation page rejects an invalid link without exposing it in the URL', async ({
  page,
}) => {
  await page.goto('/verify-email#AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  await expect(page.getByRole('button', { name: 'Подтвердить email', exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/\/verify-email$/);
  await page.getByRole('button', { name: 'Подтвердить email', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
});

test('Email: outbox link confirms the authenticated account', async ({ page }) => {
  const registration = await page.request.post('/api/v1/auth/register', {
    data: {
      companyName: 'Email Salon',
      ownerName: 'Владелец email',
      email: `mail.${Date.now()}@example.test`,
      password: 'EmailPassword123!',
      termsAccepted: true,
    },
  });
  expect(registration.status()).toBe(201);
  const { data: auth } = await registration.json();
  expect(
    (
      await page.request.post('/api/v1/auth/email-verification/request', {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      })
    ).status(),
  ).toBe(202);
  const connection = process.env.DATABASE_URL;
  if (
    !connection ||
    new URL(connection).pathname !== '/zapis_test' ||
    new URL(connection).hostname !== 'localhost'
  )
    throw new Error('Local test database required');
  const pg = await import('pg');
  const db = new pg.default.Client({ connectionString: connection });
  await db.connect();
  let url = '';
  try {
    const rows = await db.query<{ payload: { verifyUrl: string } }>(
      'SELECT "payload" FROM "OutboxMessage" WHERE "companyId"=$1 AND "kind"=$2 ORDER BY "createdAt" DESC LIMIT 1',
      [auth.company.id, 'EMAIL_VERIFICATION'],
    );
    url = rows.rows[0]?.payload.verifyUrl ?? '';
  } finally {
    await db.end();
  }
  expect(url).toContain('/verify-email#');
  await page.goto(url);
  await page.getByRole('button', { name: 'Подтвердить email', exact: true }).click();
  await expect(page.getByText('Email подтверждён', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'В профиль', exact: true }).click();
  await expect(page.getByText('Email подтверждён', { exact: true })).toBeVisible();
});

test('Invitation: owner invites a manager, who sets a password and opens the calendar', async ({
  page,
  browser,
}) => {
  const email = `invite-owner.${Date.now()}@example.test`;
  const invitedEmail = `invite-staff.${Date.now()}@example.test`;
  const registration = await page.request.post('/api/v1/auth/register', {
    data: {
      companyName: 'Invitation Salon',
      ownerName: 'Владелец команды',
      email,
      password: 'Password123!',
      termsAccepted: true,
    },
  });
  expect(registration.status()).toBe(201);
  await page.goto('/dashboard/staff');
  await page.getByRole('button', { name: 'Пригласить по email', exact: true }).click();
  await page.getByLabel('Имя сотрудника', { exact: true }).fill('Приглашённый менеджер');
  await page.getByLabel('Email сотрудника', { exact: true }).fill(invitedEmail);
  await page.getByLabel('Роль сотрудника', { exact: true }).selectOption('MANAGER');
  await page.getByRole('button', { name: 'Отправить приглашение', exact: true }).click();
  const link = page.getByLabel('Ссылка приглашения', { exact: true });
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  const context = await browser.newContext();
  const staffPage = await context.newPage();
  await staffPage.goto(url);
  await staffPage.locator('#reset-new-password').fill('InvitedPassword123!');
  await staffPage.locator('#reset-confirm-password').fill('InvitedPassword123!');
  await staffPage.getByRole('button', { name: /Сохранить|Установить|Изменить|Обновить/ }).click();
  await expect(staffPage.getByText('Пароль обновлён', { exact: true }).first()).toBeVisible();
  await staffPage.goto('/login');
  await staffPage.locator('#login-email').fill(invitedEmail);
  await staffPage.locator('#login-password').fill('InvitedPassword123!');
  await staffPage.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(staffPage).toHaveURL(/\/dashboard\/schedule$/);
  await expect(staffPage.getByRole('link', { name: 'Клиенты', exact: true })).toBeVisible();
  await expect(staffPage.getByRole('link', { name: 'Сотрудники', exact: true })).toHaveCount(0);
  await staffPage.goto('/dashboard/billing');
  await expect(staffPage).toHaveURL(/\/dashboard\/schedule$/);
  await context.close();
});
