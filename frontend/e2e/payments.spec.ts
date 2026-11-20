import { expect, test } from '@playwright/test';

const PNG_1X1_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64',
);

test('Phase 4 Payments: manual business payments, proof upload without auto-confirm, confirm, partial refund, billing proof, analytics & layout', async ({
  page,
}) => {
  const email = `paye2e.${Date.now()}@example.test`;
  const regRes = await page.request.post('/api/v1/auth/register', {
    data: {
      companyName: 'Payments Salon E2E',
      businessType: 'BEAUTY_SALON',
      ownerName: 'Саида Владелец',
      email,
      password: 'PaymentsPass123!',
      termsAccepted: true,
    },
  });
  expect(regRes.status()).toBe(201);

  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard/payments');
  await expect(page.getByRole('heading', { name: 'Журнал платежей' })).toBeVisible();
  await expect(page.getByTestId('net-confirmed-revenue')).toHaveText('0 сом');

  // 1. Create pending payment (500 KGS via MBANK)
  await page.getByRole('button', { name: 'Добавить платёж' }).click();
  const createDialog = page.getByRole('dialog');
  await expect(createDialog).toBeVisible();
  await createDialog.locator('#biz-pay-kind').selectOption('PAYMENT');
  await createDialog.locator('#biz-pay-method').selectOption('MBANK');
  await createDialog.locator('#biz-pay-amount').fill('500');
  await createDialog.locator('#biz-pay-ref').fill('MB-E2E-1');
  await expect(createDialog.locator('#biz-pay-confirm')).not.toBeChecked();
  await createDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(createDialog).toHaveCount(0);

  const paymentRow = page.locator('tbody tr', { hasText: 'MB-E2E-1' });
  await expect(paymentRow).toBeVisible();
  await expect(paymentRow.getByText('На проверке')).toBeVisible();
  await expect(paymentRow.getByText('500 сом')).toBeVisible();
  await expect(page.getByTestId('net-confirmed-revenue')).toHaveText('0 сом');

  // 2. Attach real PNG proof -> must stay PENDING and net revenue remains 0 сом
  await paymentRow.locator('input[aria-label="Загрузить чек для платежа 500.00"]').setInputFiles({
    name: 'receipt.png',
    mimeType: 'image/png',
    buffer: PNG_1X1_BUFFER,
  });

  const proofButton = paymentRow.getByRole('button', { name: 'receipt.png' });
  await expect(proofButton).toBeVisible();
  await expect(paymentRow.getByText('На проверке')).toBeVisible();
  await expect(page.getByTestId('net-confirmed-revenue')).toHaveText('0 сом');

  // Verify private proof download endpoint returns 200 WebP with private no-store cache
  const [proofResp] = await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/payments/') &&
        res.url().includes('/proofs/') &&
        res.request().method() === 'GET',
    ),
    proofButton.click(),
  ]);
  expect(proofResp.status()).toBe(200);
  expect(proofResp.headers()['content-type']).toContain('image/webp');
  expect(proofResp.headers()['cache-control']).toContain('no-store');

  // 3. Confirm payment manually & verify persistence across reload
  await paymentRow.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page.getByTestId('net-confirmed-revenue')).toHaveText('500 сом');
  await expect(paymentRow.getByText('Подтверждён')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('net-confirmed-revenue')).toHaveText('500 сом');
  await expect(
    page.locator('tbody tr', { hasText: 'MB-E2E-1' }).getByText('Подтверждён'),
  ).toBeVisible();

  // 4. Create confirmed partial refund (150 KGS) -> net becomes 350 сом
  await page.getByRole('button', { name: 'Добавить платёж' }).click();
  const refundDialog = page.getByRole('dialog');
  await expect(refundDialog).toBeVisible();
  await refundDialog.locator('#biz-pay-kind').selectOption('REFUND');
  await refundDialog.locator('#biz-pay-amount').fill('150');
  await refundDialog.locator('#biz-pay-ref').fill('REF-E2E-1');
  await refundDialog.locator('#biz-pay-confirm').check();
  await refundDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(refundDialog).toHaveCount(0);

  await expect(page.getByTestId('net-confirmed-revenue')).toHaveText('350 сом');

  // Verify zero horizontal overflow & capture desktop screenshot
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: '../artifacts/bron-payments/payments-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });

  // Check mobile viewport (360x800) zero horizontal overflow & screenshot
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: '../artifacts/bron-payments/payments-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 900 });

  // 5. Subscription claim + proof upload in /dashboard/billing
  await page.goto('/dashboard/billing');
  await page.getByRole('button', { name: 'Я оплатил' }).click();
  const claimDialog = page.getByRole('dialog');
  await expect(claimDialog).toBeVisible();
  await claimDialog.locator('#claim-reference').fill('BILL-E2E-1');
  await claimDialog.getByRole('button', { name: 'Отправить заявку', exact: true }).click();
  await expect(claimDialog).toHaveCount(0);

  await expect(page.getByText(/находится на проверке/)).toBeVisible();
  await page.locator('input[aria-label="Прикрепить чек к заявке"]').setInputFiles({
    name: 'bill-proof.png',
    mimeType: 'image/png',
    buffer: PNG_1X1_BUFFER,
  });

  await expect(page.getByRole('button', { name: 'bill-proof.png' }).first()).toBeVisible();
  await expect(page.getByText(/находится на проверке/)).toBeVisible();
  await page.screenshot({
    path: '../artifacts/bron-payments/billing-proof.png',
    fullPage: true,
    animations: 'disabled',
  });

  // 6. Verify /dashboard/analytics reconciles netConfirmedRevenue separately
  await page.goto('/dashboard/analytics');
  await expect(page.getByTestId('analytics-confirmed-revenue')).toHaveText('350 сом');
  await expect(page.getByText('Оценка по завершённым визитам')).toBeVisible();

  expect(errors).toEqual([]);
});
