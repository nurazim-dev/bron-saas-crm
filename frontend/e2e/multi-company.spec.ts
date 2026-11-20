import { expect, test } from '@playwright/test';
import { DateTime } from 'luxon';

test('Multi-company: owner creates second company, switches both ways without stale data, and persists across reload', async ({
  page,
}) => {
  const email = `multico.${Date.now()}@example.test`;
  const password = 'MultiCompany123!';

  const registration = await page.request.post('/api/v1/auth/register', {
    data: {
      companyName: 'Барбершоп Альфа',
      businessType: 'BARBERSHOP',
      ownerName: 'Азамат Альфа',
      email,
      password,
      termsAccepted: true,
    },
  });
  expect(registration.status()).toBe(201);
  const { data: authA } = await registration.json();
  const headersA = { Authorization: `Bearer ${authA.accessToken}` };

  // Seed distinct service & appointment in Company A
  const serviceARes = await page.request.post('/api/v1/services', {
    headers: headersA,
    data: { name: 'Стрижка Альфа', durationMin: 30, price: '600.00' },
  });
  expect(serviceARes.status()).toBe(201);
  const { data: serviceA } = await serviceARes.json();

  expect(
    (
      await page.request.put(`/api/v1/staff/${authA.user.id}/services`, {
        headers: headersA,
        data: { serviceIds: [serviceA.id] },
      })
    ).status(),
  ).toBe(200);

  const apptDate = DateTime.now().setZone('Asia/Bishkek').plus({ days: 2 }).toFormat('yyyy-MM-dd');
  const apptARes = await page.request.post('/api/v1/appointments', {
    headers: headersA,
    data: {
      masterId: authA.user.id,
      serviceId: serviceA.id,
      startAt: DateTime.fromISO(`${apptDate}T10:00`, { zone: 'Asia/Bishkek' }).toUTC().toISO(),
      clientName: 'Клиент Альфа',
      clientPhone: '+996555111001',
    },
  });
  expect(apptARes.status()).toBe(201);

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  // Open appointments in Company A
  await page.goto('/dashboard/appointments');
  await expect(page.getByTestId('company-switcher-trigger')).toContainText('Барбершоп Альфа');
  await expect(page.getByText('Клиент Альфа', { exact: true })).toBeVisible();

  // Create Company B from Company Switcher UI
  await page.getByTestId('company-switcher-trigger').click();
  await page.getByRole('button', { name: 'Создать компанию', exact: true }).click();
  await page.getByLabel('Название компании', { exact: true }).fill('Салон Бета');
  await page.getByLabel('Тип бизнеса', { exact: true }).selectOption('BEAUTY_SALON');

  const createResponsePromise = page.waitForResponse(
    (res) => res.url().endsWith('/api/v1/auth/companies') && res.request().method() === 'POST',
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Создать компанию', exact: true })
    .click();

  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const { data: authB } = await createResponse.json();
  const headersB = { Authorization: `Bearer ${authB.accessToken}` };

  await expect(page.getByTestId('company-switcher-trigger')).toContainText('Салон Бета');
  await expect(page.getByText('Клиент Альфа', { exact: true })).toHaveCount(0);

  // Seed distinct service & appointment in Company B
  const serviceBRes = await page.request.post('/api/v1/services', {
    headers: headersB,
    data: { name: 'Укладка Бета', durationMin: 45, price: '900.00' },
  });
  expect(serviceBRes.status()).toBe(201);
  const { data: serviceB } = await serviceBRes.json();

  expect(
    (
      await page.request.put(`/api/v1/staff/${authB.user.id}/services`, {
        headers: headersB,
        data: { serviceIds: [serviceB.id] },
      })
    ).status(),
  ).toBe(200);

  const apptBRes = await page.request.post('/api/v1/appointments', {
    headers: headersB,
    data: {
      masterId: authB.user.id,
      serviceId: serviceB.id,
      startAt: DateTime.fromISO(`${apptDate}T12:00`, { zone: 'Asia/Bishkek' }).toUTC().toISO(),
      clientName: 'Клиент Бета',
      clientPhone: '+996555222002',
    },
  });
  expect(apptBRes.status()).toBe(201);

  await page.goto('/dashboard/appointments');
  await expect(page.getByTestId('company-switcher-trigger')).toContainText('Салон Бета');
  await expect(page.getByText('Клиент Бета', { exact: true })).toBeVisible();
  await expect(page.getByText('Клиент Альфа', { exact: true })).toHaveCount(0);

  // Stale-response race check: trigger a Company B appointments request, hold it,
  // switch to Company A, release the delayed Company B payload, and verify Company A stays clean.
  let releaseDelayed!: () => void;
  const delayedGate = new Promise<void>((resolve) => {
    releaseDelayed = resolve;
  });
  let delayedCaptured!: () => void;
  const delayedCapturedPromise = new Promise<void>((resolve) => {
    delayedCaptured = resolve;
  });
  let interceptedOnce = false;

  await page.route('**/api/v1/appointments?*', async (route) => {
    const req = route.request();
    if (!interceptedOnce && req.method() === 'GET' && req.url().includes('status=SCHEDULED')) {
      interceptedOnce = true;
      delayedCaptured();
      await delayedGate;
      await route
        .fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              {
                id: '00000000-0000-4000-8000-000000000999',
                companyId: authB.company.id,
                masterId: authB.user.id,
                serviceId: serviceB.id,
                clientId: '00000000-0000-4000-8000-000000000888',
                clientName: 'Клиент Бета',
                clientPhone: '+996555222002',
                clientNote: null,
                internalNote: null,
                startAt: DateTime.fromISO(`${apptDate}T12:00`, { zone: 'Asia/Bishkek' })
                  .toUTC()
                  .toISO(),
                endAt: DateTime.fromISO(`${apptDate}T12:45`, { zone: 'Asia/Bishkek' })
                  .toUTC()
                  .toISO(),
                price: '900.00',
                status: 'SCHEDULED',
                source: 'STAFF',
                service: { id: serviceB.id, name: 'Укладка Бета', durationMin: 45 },
                master: { id: authB.user.id, name: 'Азамат Альфа' },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
            meta: { page: 1, limit: 20, total: 1 },
          }),
        })
        .catch(() => undefined);
      return;
    }
    await route.continue();
  });

  // Trigger the filtered fetch in Company B
  await page.getByLabel('Статус').selectOption('SCHEDULED');
  await delayedCapturedPromise;

  // Immediately switch to Company A while Company B request is still pending
  await page.getByTestId('company-switcher-trigger').click();
  await page.getByRole('menuitemradio', { name: /Барбершоп Альфа/ }).click();

  await expect(page.getByTestId('company-switcher-trigger')).toContainText('Барбершоп Альфа');
  await expect(page.getByText('Клиент Альфа', { exact: true })).toBeVisible();

  // Release delayed Company B response and confirm Company A never displays stale Company B rows
  releaseDelayed();
  await page.waitForTimeout(200);
  await page.unroute('**/api/v1/appointments?*');

  await expect(page.getByText('Клиент Альфа', { exact: true })).toBeVisible();
  await expect(page.getByText('Клиент Бета', { exact: true })).toHaveCount(0);

  // Switch back to Company B and reload the page — active company persists
  await page.getByTestId('company-switcher-trigger').click();
  await page.getByRole('menuitemradio', { name: /Салон Бета/ }).click();
  await expect(page.getByTestId('company-switcher-trigger')).toContainText('Салон Бета');
  await expect(page.getByText('Клиент Бета', { exact: true })).toBeVisible();
  await expect(page.getByText('Клиент Альфа', { exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId('company-switcher-trigger')).toContainText('Салон Бета');
  await expect(page.getByText('Клиент Бета', { exact: true })).toBeVisible();
  await expect(page.getByText('Клиент Альфа', { exact: true })).toHaveCount(0);

  // Responsive layout & visual artifacts
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `../artifacts/bron-multicompany/switcher-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }

  expect(errors).toEqual([]);
});
