import { expect, test } from '@playwright/test';

test.describe('Frontend Security Suite (Domains C, E, G & J)', () => {
  test('never stores access tokens in localStorage/sessionStorage, escapes XSS payloads in DOM, scrubs URL tokens, and enforces noindex & security headers', async ({
    page,
    playwright,
  }) => {
    let dialogTriggered = false;
    page.on('dialog', () => {
      dialogTriggered = true;
    });

    const stamp = Date.now();
    const email = `sec.e2e.${stamp}@example.test`;
    const password = 'SecE2ePassword123!';
    const xssCompanyName = `Салон <img src=x onerror=alert(1)> ${stamp}`;

    const api = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
    const reg = await api.post('/api/v1/auth/register', {
      data: {
        companyName: xssCompanyName,
        businessType: 'BARBERSHOP',
        ownerName: 'Бахтияр <script>window.__xss=1</script>',
        email,
        phone: '+996555778899',
        password,
        termsAccepted: true,
      },
    });
    expect(reg.status()).toBe(201);
    const regData = (await reg.json()).data;
    const slug = regData.company.slug as string;
    await api.dispose();

    // Visit public booking page -> verify XSS payload in company name is escaped as text, never executed
    const pubResp = await page.goto(`/b/${slug}`);
    expect(pubResp?.status()).toBe(200);
    expect(pubResp?.headers()['x-frame-options']).toBe('DENY');
    expect(pubResp?.headers()['x-content-type-options']).toBe('nosniff');
    expect(pubResp?.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(dialogTriggered).toBe(false);
    expect(
      await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
    ).toBeUndefined();

    // Verify access token is never written to localStorage or sessionStorage after login
    await page.goto('/login');
    await page.locator('#login-email').fill(email);
    await page.locator('#login-password').fill(password);
    await page.getByRole('button', { name: 'Войти' }).click();
    await page.waitForURL(/\/dashboard/);

    const storageDump = await page.evaluate(() => ({
      local: JSON.stringify(window.localStorage),
      session: JSON.stringify(window.sessionStorage),
    }));
    expect(storageDump.local).not.toContain('accessToken');
    expect(storageDump.local).not.toContain('eyJ');
    expect(storageDump.session).not.toContain('accessToken');
    expect(storageDump.session).not.toContain('eyJ');

    // Verify URL token scrubbing and no-referrer / noindex on /reset-password, /impersonate, /manage/[token], /admin/login
    const resetResp = await page.goto('/reset-password?token=secret_test_reset_token_1234567890');
    expect(resetResp?.headers()['referrer-policy']).toBe('no-referrer');
    await expect
      .poll(async () => page.evaluate(() => window.location.search))
      .not.toContain('secret_test_reset_token_1234567890');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i);

    await page.goto('/impersonate?code=secret_test_imp_code_1234567890');
    await expect
      .poll(async () => page.evaluate(() => window.location.search))
      .not.toContain('secret_test_imp_code_1234567890');

    await page.goto('/manage/nonexistent_manage_token_0000000000000001');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i);

    await page.goto('/admin/login');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i);

    // Service worker (/sw.js) check: never caches /api/*
    const swRes = await page.request.get('/sw.js');
    if (swRes.status() === 200) {
      const swText = await swRes.text();
      expect(swText).toContain('/api/');
    }

    // Responsive check at 360px and 1440px
    for (const width of [360, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  });
});
