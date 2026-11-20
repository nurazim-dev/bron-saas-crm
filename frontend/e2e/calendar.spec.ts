import { expect, test } from '@playwright/test';
import { DateTime } from 'luxon';
import { getCalendarPeriod, shiftCalendarDate } from '../src/lib/datetime';

test('Calendar periods respect DST, leap years and month boundaries', () => {
  const spring = getCalendarPeriod('2026-03-08', 'day', 'America/New_York');
  expect(DateTime.fromISO(spring.toUtc).diff(DateTime.fromISO(spring.fromUtc), 'hours').hours).toBe(
    23,
  );
  const fall = getCalendarPeriod('2026-11-01', 'day', 'America/New_York');
  expect(DateTime.fromISO(fall.toUtc).diff(DateTime.fromISO(fall.fromUtc), 'hours').hours).toBe(25);
  const month = getCalendarPeriod('2028-02-29', 'month', 'Asia/Bishkek');
  expect(month.dates).toContain('2028-02-29');
  expect(month.dates.length % 7).toBe(0);
  expect(shiftCalendarDate('2028-01-31', 'month', 1, 'Asia/Bishkek')).toBe('2028-02-29');
  expect(getCalendarPeriod('2027-01-01', 'week', 'Asia/Bishkek').dates[0]).toBe('2026-12-28');
});

test('Calendar: real appointments, filters, day/week/month, mobile and retry', async ({ page }) => {
  const email = `calendar.${Date.now()}@example.test`;
  const password = 'CalendarTest123!';
  const registration = await page.request.post('/api/v1/auth/register', {
    data: {
      companyName: 'Календарь Phase 2',
      ownerName: 'Владелец календаря',
      email,
      password,
      termsAccepted: true,
    },
  });
  expect(registration.status()).toBe(201);
  const { data: auth } = await registration.json();
  const headers = { Authorization: `Bearer ${auth.accessToken}` };
  const serviceRes = await page.request.post('/api/v1/services', {
    headers,
    data: { name: 'Стрижка календаря', durationMin: 30, price: '750.00' },
  });
  expect(serviceRes.status()).toBe(201);
  const { data: service } = await serviceRes.json();
  const secondRes = await page.request.post('/api/v1/services', {
    headers,
    data: { name: 'Укладка календаря', durationMin: 30, price: '450.00' },
  });
  expect(secondRes.status()).toBe(201);
  const { data: second } = await secondRes.json();
  expect(
    (
      await page.request.put(`/api/v1/staff/${auth.user.id}/services`, {
        headers,
        data: { serviceIds: [service.id, second.id] },
      })
    ).status(),
  ).toBe(200);
  const date = DateTime.now().setZone('Asia/Bishkek').plus({ days: 2 }).toFormat('yyyy-MM-dd');
  const appointmentRes = await page.request.post('/api/v1/appointments', {
    headers,
    data: {
      masterId: auth.user.id,
      serviceId: service.id,
      startAt: DateTime.fromISO(`${date}T10:00`, { zone: 'Asia/Bishkek' }).toUTC().toISO(),
      clientName: 'Клиент календаря',
      clientPhone: '+996555888777',
    },
  });
  expect(appointmentRes.status()).toBe(201);
  const { data: appointment } = await appointmentRes.json();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !message.text().includes('503') &&
      !message.text().includes('409')
    )
      errors.push(message.text());
  });
  await page.goto('/dashboard/schedule');
  await expect(page.getByRole('heading', { name: 'Расписание', exact: true })).toBeVisible();
  await page.getByLabel('Дата визита', { exact: true }).fill(date);
  await page.getByRole('button', { name: 'Неделя', exact: true }).click();
  await expect(page.getByRole('button').filter({ hasText: 'Клиент календаря' })).toBeVisible();
  await page.getByLabel('Фильтр по услуге').selectOption(second.id);
  await expect(page.getByRole('button').filter({ hasText: 'Клиент календаря' })).toHaveCount(0);
  await page.getByLabel('Фильтр по услуге').selectOption(service.id);
  await page.getByRole('button').filter({ hasText: 'Клиент календаря' }).click();
  await expect(page.getByRole('dialog')).toContainText('Клиент календаря');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({
    path: '../artifacts/bron-phase2/week-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Месяц', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Календарь месяца' })).toBeVisible();
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('button').filter({ hasText: 'Клиент календаря' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: `../artifacts/bron-phase2/month-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'День', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Записи по дням' })).toBeVisible();
  await expect(page.getByRole('button').filter({ hasText: 'Клиент календаря' })).toBeVisible();
  await page.screenshot({
    path: '../artifacts/bron-phase2/day-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });

  await page.getByRole('button', { name: 'Новая запись', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Новая запись');
  for (let i = 0; i < 20; i += 1) {
    await page.keyboard.press('Tab');
    expect(
      await page.getByRole('dialog').evaluate((dialog) => dialog.contains(document.activeElement)),
    ).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 1000 });
  const source = page.locator('button[draggable="true"]').filter({ hasText: 'Клиент календаря' });
  const target = page.getByRole('button', { name: /Владелец календаря • 14:00/ });
  await source.dragTo(target);
  await expect(page.getByRole('dialog')).toContainText('Перенести запись?');
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  const unchanged = await page.request.get(`/api/v1/appointments/${appointment.id}`, { headers });
  expect((await unchanged.json()).data.startAt).toBe(appointment.startAt);
  await source.dragTo(target);
  await page.getByRole('button', { name: 'Подтвердить перенос' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Запись перенесена');
  const moved = await page.request.get(`/api/v1/appointments/${appointment.id}`, { headers });
  const movedBody = (await moved.json()).data;
  expect(movedBody.startAt).toBe(
    DateTime.fromISO(`${date}T14:00`, { zone: 'Asia/Bishkek' }).toUTC().toISO(),
  );
  expect(movedBody.price).toBe(appointment.price);
  expect(movedBody.serviceIds).toEqual(appointment.serviceIds);
  await page.screenshot({
    path: '../artifacts/bron-drag/moved-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.reload();
  await page.getByLabel('Дата визита', { exact: true }).fill(date);
  await expect(source).toBeVisible();
  // A real occupied interval must be rejected without moving the original record.
  const destination = page.getByRole('button', { name: /Владелец календаря • 15:00/ });
  await destination.scrollIntoViewIfNeeded();
  await source.scrollIntoViewIfNeeded();
  const fromBox = await source.boundingBox();
  const toBox = await destination.boundingBox();
  if (!fromBox || !toBox) throw new Error('Missing drag geometry');
  await page.mouse.move(fromBox.x + 30, fromBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(fromBox.x + 40, fromBox.y + 15, { steps: 4 });
  await page.mouse.move(toBox.x + 50, toBox.y + 10, { steps: 10 });
  await page.mouse.move(toBox.x + 55, toBox.y + 15);
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toContainText('Перенести запись?');
  const conflict = await page.request.post('/api/v1/appointments', {
    headers,
    data: {
      masterId: auth.user.id,
      serviceId: service.id,
      startAt: DateTime.fromISO(`${date}T15:00`, { zone: 'Asia/Bishkek' }).toUTC().toISO(),
      clientName: 'Занятый интервал',
      clientPhone: '+996555888778',
    },
  });
  expect(conflict.status()).toBe(201);
  await page.getByRole('button', { name: 'Подтвердить перенос' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  expect(
    (await (await page.request.get(`/api/v1/appointments/${appointment.id}`, { headers })).json())
      .data.startAt,
  ).toBe(movedBody.startAt);
  await page.setViewportSize({ width: 390, height: 844 });

  // Simulate a two-page response to verify the calendar does not stop at page 1.
  let secondPageLoaded = false;
  await page.route('**/api/v1/appointments?**', async (route) => {
    const url = new URL(route.request().url());
    const isSecond = url.searchParams.get('page') === '2';
    if (isSecond) secondPageLoaded = true;
    await route.fulfill({
      json: {
        data: isSecond ? [appointment] : [],
        meta: { page: isSecond ? 2 : 1, limit: 200, total: 201 },
      },
    });
  });
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect.poll(() => secondPageLoaded).toBe(true);
  await expect(page.getByRole('button').filter({ hasText: 'Клиент календаря' })).toBeVisible();
  await page.unroute('**/api/v1/appointments?**');
  await page.route('**/api/v1/appointments?**', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'INTERNAL_ERROR', message: 'Test outage' } },
    }),
  );
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Попробовать снова', exact: true })).toBeVisible();
  await page.unroute('**/api/v1/appointments?**');
  await page.getByRole('button', { name: 'Попробовать снова', exact: true }).click();
  await expect(page.getByRole('button').filter({ hasText: 'Клиент календаря' })).toBeVisible();
  expect(errors).toEqual([]);
});
