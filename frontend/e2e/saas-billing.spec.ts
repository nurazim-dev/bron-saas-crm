import { expect, test } from '@playwright/test';

test('Phase 5 SaaS Billing: FREE/BUSINESS/PRO lineup, switch-free, 402 gates, separate pending claim & layout', async ({
  page,
}) => {
  const email = `saase2e.${Date.now()}@example.test`;
  const regRes = await page.request.post('/api/v1/auth/register', {
    data: {
      companyName: 'SaaS Salon E2E',
      businessType: 'BEAUTY_SALON',
      ownerName: 'Камила Владелец',
      email,
      password: 'SaasPassword123!',
      termsAccepted: true,
    },
  });
  expect(regRes.status()).toBe(201);
  const { data: auth } = await regRes.json();
  const headers = { Authorization: `Bearer ${auth.accessToken}` };

  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard/billing');
  await expect(page.getByRole('heading', { name: 'Оплата и тариф' })).toBeVisible();
  await expect(page.getByText('Текущий тариф: Бизнес')).toBeVisible();

  // Verify 4 usage meters & FREE/BUSINESS/PRO cards
  const main = page.getByRole('main');
  await expect(main.getByText('Сотрудники', { exact: true })).toBeVisible();
  await expect(main.getByText('Услуги', { exact: true })).toBeVisible();
  await expect(main.getByText('Записи за месяц', { exact: true })).toBeVisible();
  await expect(main.getByText('Авто-напоминания за месяц', { exact: true })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Бесплатный' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Бизнес' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Про' })).toBeVisible();

  // 1. Switch to FREE plan and verify persistence across reload
  await page.getByRole('button', { name: 'Перейти на Бесплатный', exact: true }).click();
  await expect(page.getByText('Текущий тариф: Бесплатный')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Текущий тариф: Бесплатный')).toBeVisible();

  // 2. Verify server-side 402 FEATURE_NOT_IN_PLAN via page.request while preserving reads
  const tagFail = await page.request.post('/api/v1/clients/tags', {
    headers,
    data: { name: 'BlockedOnFree' },
  });
  expect(tagFail.status()).toBe(402);
  expect((await tagFail.json()).error.code).toBe('FEATURE_NOT_IN_PLAN');

  const payFail = await page.request.post('/api/v1/payments', {
    headers,
    data: { kind: 'PAYMENT', amount: '500', method: 'CASH' },
  });
  expect(payFail.status()).toBe(402);
  expect((await payFail.json()).error.code).toBe('FEATURE_NOT_IN_PLAN');

  const payRead = await page.request.get('/api/v1/payments', { headers });
  expect(payRead.status()).toBe(200);

  // 3. Submit a paid claim from FREE -> only paid plans in selector; pending claim stays separate
  await page.getByRole('button', { name: 'Я оплатил' }).click();
  const claimDialog = page.getByRole('dialog');
  await expect(claimDialog).toBeVisible();
  const planOptions = await claimDialog.locator('#claim-plan option').allTextContents();
  expect(planOptions.some((t) => t.includes('Бесплатный'))).toBe(false);
  expect(planOptions.some((t) => t.includes('Бизнес'))).toBe(true);
  expect(planOptions.some((t) => t.includes('Про'))).toBe(true);

  await claimDialog.locator('#claim-reference').fill('SAAS-E2E-1');
  await claimDialog.getByRole('button', { name: 'Отправить заявку', exact: true }).click();
  await expect(claimDialog).toHaveCount(0);

  await expect(page.getByText(/находится на проверке/)).toBeVisible();
  await expect(page.getByText('Текущий тариф: Бесплатный')).toBeVisible();

  // Verify zero horizontal overflow on desktop & mobile + capture screenshots
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: '../artifacts/bron-saas/billing-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });

  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: '../artifacts/bron-saas/billing-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });

  expect(errors).toEqual([]);
});
