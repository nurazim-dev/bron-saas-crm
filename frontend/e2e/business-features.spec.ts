import { expect, test } from '@playwright/test';

test('Phase 6 Business Features: branding, RU/KY/EN switcher, dark mode, EN public booking & payments CSV', async ({
  page,
}) => {
  const email = `bizfeatures.${Date.now()}@example.test`;
  const regRes = await page.request.post('/api/v1/auth/register', {
    data: {
      companyName: 'Bishkek Glow Studio',
      businessType: 'BEAUTY_SALON',
      ownerName: 'Айгуль Владелец',
      email,
      password: 'BizPassword123!',
      termsAccepted: true,
    },
  });
  expect(regRes.status()).toBe(201);
  const { data: auth } = await regRes.json();
  const headers = { Authorization: `Bearer ${auth.accessToken}` };
  const slug: string = auth.company.slug;

  // Create a service so public booking page shows services in EN
  const svcRes = await page.request.post('/api/v1/services', {
    headers,
    data: {
      name: 'Signature Facial',
      durationMin: 60,
      price: '2200.00',
    },
  });
  expect(svcRes.status()).toBe(201);

  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard/settings');
  await expect(page.getByRole('heading', { name: 'Настройки компании' })).toBeVisible();
  await expect(page.locator('#company-slug')).toHaveValue(slug);

  // 1. Test Dark Mode toggle and capture dark mode screenshot before toast appears
  const themeToggle = page.getByTestId('theme-toggle');
  await themeToggle.click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: '../artifacts/bron-business/dashboard-dark.png',
    fullPage: true,
    animations: 'disabled',
  });
  await themeToggle.click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);

  // 2. Test Dashboard language switcher (RU -> EN -> KY -> RU) before toast appears
  const langSelect = page.getByTestId('dashboard-lang-select');
  await langSelect.selectOption('en');
  await expect(page.getByRole('link', { name: 'Schedule' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();

  await langSelect.selectOption('ky');
  await expect(page.getByRole('link', { name: 'Жүгүртмө' })).toBeVisible();

  await langSelect.selectOption('ru');
  await expect(page.getByRole('link', { name: 'Расписание' })).toBeVisible();

  // 3. Update branding & defaultLocale=EN in settings
  await page.locator('#company-description').fill('Premium skincare and beauty studio in Bishkek');
  await page.locator('#company-instagram').fill('https://instagram.com/bishkekglow');
  await page.locator('#company-brand-color').fill('#0f766e');
  await page.locator('#company-default-locale').selectOption('EN');
  await page.getByRole('button', { name: 'Сохранить настройки' }).click();
  await expect(page.getByText('Настройки компании сохранены')).toBeVisible();

  // 4. Verify Analytics page has payments CSV export button
  await page.goto('/dashboard/analytics');
  await expect(page.getByRole('button', { name: 'Экспорт платежей CSV' })).toBeVisible();

  // 5. Open public booking page /b/[slug], verify branding & switch to English
  await page.goto(`/b/${slug}`);
  await expect(page.getByText('Premium skincare and beauty studio in Bishkek')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Instagram' })).toBeVisible();

  await page.getByRole('button', { name: 'Eng' }).click();
  await expect(page.getByText('Choose a service')).toBeVisible();
  await expect(page.getByText('Signature Facial')).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: '../artifacts/bron-business/public-en-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });

  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: '../artifacts/bron-business/public-en-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });

  expect(errors).toEqual([]);
});
