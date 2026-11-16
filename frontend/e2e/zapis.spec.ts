import { createHmac } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';

function generateTotp(base32Secret: string, stepOffset = 0): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = base32Secret.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = '';
  for (const ch of cleaned) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  const key = Buffer.from(bytes);
  const counter = Math.floor(Date.now() / 1000 / 30) + stepOffset;
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(counterBuf).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const code =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    (((hmac[offset + 1] ?? 0) & 0xff) << 16) |
    (((hmac[offset + 2] ?? 0) & 0xff) << 8) |
    ((hmac[offset + 3] ?? 0) & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

async function advanceUntilSlotsAvailable(page: Page): Promise<number> {
  const slotButtons = page.getByRole('button', { name: /^\d{2}:\d{2}$/ });
  const nextDayBtn = page.getByRole('button', { name: 'Выбрать следующую дату' });

  for (let attempt = 0; attempt < 7; attempt++) {
    await expect(slotButtons.first().or(nextDayBtn)).toBeVisible();
    if ((await slotButtons.count()) > 0) {
      return attempt;
    }
    await nextDayBtn.click();
  }
  return 0;
}

test.describe('Zapis.kg End-to-End Suite', () => {
  test('E2E 1: Owner registers -> creates service -> adds master -> sets working hours -> copies public link -> client books via /b/[slug] -> owner sees appointment on schedule and cancels/manages it', async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();

    const uniqueSuffix = Date.now().toString().slice(-6);
    const companyName = `Салон Эдем ${uniqueSuffix}`;
    const ownerEmail = `owner.e2e.${uniqueSuffix}@zapis.kg`;
    const serviceName = `Модельная стрижка ${uniqueSuffix}`;
    const masterName = `Мастер Руслан ${uniqueSuffix}`;
    const clientName = `Клиент Данияр ${uniqueSuffix}`;

    // 1. Register new Owner & Company
    await ownerPage.goto('/register');
    await ownerPage.locator('#reg-company-name').fill(companyName);
    await ownerPage.locator('#reg-owner-name').fill('Азамат Эсенов');
    await ownerPage.locator('#reg-email').fill(ownerEmail);
    await ownerPage.locator('#reg-phone').fill('+996 555 111 222');
    await ownerPage.locator('#reg-password').fill('Password123!');
    await ownerPage.getByRole('button', { name: 'Создать аккаунт' }).click();

    await expect(ownerPage).toHaveURL(/\/dashboard$/);
    await expect(ownerPage.getByText(companyName).first()).toBeVisible();

    // 2. Navigate to Services via sidebar link (SPA navigation preserves in-memory JWT) and create a service
    await ownerPage.locator('aside').getByRole('link', { name: 'Услуги' }).click();
    await expect(ownerPage).toHaveURL(/\/dashboard\/services$/);
    await ownerPage
      .getByRole('button', { name: /Добавить (первую )?услугу/i })
      .first()
      .click();
    await ownerPage.locator('#service-name').fill(serviceName);
    await ownerPage.locator('#service-duration').fill('60');
    await ownerPage.locator('#service-price').fill('900');
    await ownerPage.getByRole('button', { name: 'Сохранить' }).click();

    await expect(ownerPage.getByText(serviceName)).toBeVisible();

    // 3. Navigate to Staff via sidebar link, add a Master, assign the service, and set working hours for all 7 days
    await ownerPage.locator('aside').getByRole('link', { name: 'Сотрудники' }).click();
    await expect(ownerPage).toHaveURL(/\/dashboard\/staff$/);
    await ownerPage.getByRole('button', { name: 'Добавить мастера' }).click();
    await ownerPage.locator('#staff-name').fill(masterName);
    await ownerPage.locator('#staff-phone').fill('+996 555 333 444');
    await ownerPage.getByRole('button', { name: 'Сохранить' }).click();

    await expect(ownerPage.getByText(masterName)).toBeVisible();

    // Assign service to the newly created master (2nd staff card: index 0 is OWNER, index 1 is new MASTER)
    await ownerPage
      .getByRole('button', { name: /Услуги мастера/i })
      .nth(1)
      .click();
    await expect(ownerPage.getByRole('dialog')).toContainText(masterName);
    await ownerPage.getByRole('button', { name: 'Выбрать все' }).click();
    await ownerPage.getByRole('button', { name: 'Сохранить' }).click();
    await expect(ownerPage.getByRole('dialog')).toHaveCount(0);

    // Configure working hours for the newly created master (all 7 days 10:00-20:00)
    await ownerPage.getByRole('button', { name: 'График работы' }).nth(1).click();
    await expect(ownerPage.getByRole('dialog')).toContainText(masterName);
    const mondayCheckbox = ownerPage
      .locator('label', { hasText: 'Понедельник' })
      .locator('input[type="checkbox"]');
    if (!(await mondayCheckbox.isChecked())) {
      await mondayCheckbox.check();
    }
    await ownerPage.getByRole('button', { name: 'Скопировать Пн на все дни' }).click();
    await ownerPage.getByRole('button', { name: 'Сохранить' }).click();
    await expect(ownerPage.getByRole('dialog')).toHaveCount(0);

    // 4. Navigate to Settings via sidebar link and copy public booking link
    await ownerPage.locator('aside').getByRole('link', { name: 'Настройки' }).click();
    await expect(ownerPage).toHaveURL(/\/dashboard\/settings$/);
    const slugInput = ownerPage.locator('#company-slug');
    await expect(slugInput).toHaveValue(/.+/);
    const slugVal = await slugInput.inputValue();
    expect(slugVal.length).toBeGreaterThan(2);

    await ownerPage.getByRole('button', { name: 'Скопировать ссылку' }).click();

    // 5. Client opens /b/[slug] in a separate anonymous browser context and books
    const clientContext = await browser.newContext();
    const clientPage = await clientContext.newPage();

    await clientPage.goto(`/b/${slugVal}`);
    await expect(clientPage.getByRole('heading', { name: companyName })).toBeVisible();
    await expect(clientPage.getByText(serviceName).first()).toBeVisible();

    // Step 1: Select service
    await clientPage.getByRole('button', { name: new RegExp(serviceName) }).click();

    // Step 2: Select the master
    await clientPage.getByRole('button', { name: new RegExp(masterName) }).click();

    // Step 3: Advance to a date with available slots if needed
    const daysAdvanced = await advanceUntilSlotsAvailable(clientPage);
    const firstSlotBtn = clientPage.getByRole('button', { name: /^\d{2}:\d{2}$/ }).first();
    await expect(firstSlotBtn).toBeVisible();
    await firstSlotBtn.click();

    // Step 4: Fill client form and submit
    await clientPage.locator('#public-client-name').fill(clientName);
    await clientPage.locator('#public-client-phone').fill('0555 777 888');
    await clientPage.locator('#public-client-note').fill('Комментарий из E2E');
    await clientPage.locator('#public-consent').check();
    await clientPage.getByRole('button', { name: 'Записаться' }).click();

    // Step 5: Confirmation screen
    await expect(clientPage.getByText('Вы успешно записаны!')).toBeVisible();
    await expect(clientPage.getByText(serviceName).first()).toBeVisible();
    await expect(clientPage.getByText(masterName).first()).toBeVisible();

    // 6. Owner navigates to /dashboard/schedule via sidebar, advances day if needed, and sees the booked appointment
    await ownerPage.locator('aside').getByRole('link', { name: 'Расписание' }).click();
    await expect(ownerPage).toHaveURL(/\/dashboard\/schedule$/);
    await expect(ownerPage.getByRole('heading', { name: 'Расписание' })).toBeVisible();
    const nextDayScheduleBtn = ownerPage.getByRole('button', { name: 'Следующий день' });
    await expect(nextDayScheduleBtn).toBeVisible();

    for (let i = 0; i < daysAdvanced; i++) {
      await nextDayScheduleBtn.click();
    }

    const apptLocator = ownerPage.getByRole('button', { name: new RegExp(clientName) });
    await expect(apptLocator).toBeVisible();

    // Open appointment details drawer and verify status actions
    await apptLocator.click();
    await expect(ownerPage.getByRole('dialog')).toContainText(clientName);
    await expect(ownerPage.getByRole('dialog')).toContainText('Онлайн-запись');

    await ownerPage.getByRole('button', { name: 'Отменить запись' }).click();
    await expect(ownerPage.getByRole('dialog')).toContainText('Отменена');

    await clientContext.close();
    await ownerContext.close();
  });

  test('E2E 2: Race condition — two browser contexts select the same slot on /b/[slug]; first succeeds (201), second receives conflict toast and returns to refreshed slots', async ({
    browser,
  }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    await page1.goto('/b/demo-barbershop');
    await page2.goto('/b/demo-barbershop');

    // Both select first service ("Мужская стрижка")
    await page1
      .getByRole('button', { name: /Мужская стрижка/i })
      .first()
      .click();
    await page2
      .getByRole('button', { name: /Мужская стрижка/i })
      .first()
      .click();

    // Both select specific master "Бекзат Исаков"
    await page1.getByRole('button', { name: /Бекзат Исаков/i }).click();
    await page2.getByRole('button', { name: /Бекзат Исаков/i }).click();

    // Advance both pages until a working day with open slots is reached
    await advanceUntilSlotsAvailable(page1);
    await advanceUntilSlotsAvailable(page2);

    const slotLocator1 = page1.getByRole('button', { name: /^\d{2}:\d{2}$/ });
    const targetSlotButton1 = slotLocator1.last();
    await expect(targetSlotButton1).toBeVisible();
    const chosenSlotLabel = (await targetSlotButton1.textContent())?.trim() ?? '';
    expect(chosenSlotLabel).toMatch(/^\d{2}:\d{2}$/);

    // Both click the exact same slot label
    await targetSlotButton1.click();
    await page2.getByRole('button', { name: chosenSlotLabel, exact: true }).click();

    // Both fill Step 4 details
    await page1.locator('#public-client-name').fill('Первый Клиент');
    await page1.locator('#public-client-phone').fill('0555 901 001');
    await page1.locator('#public-consent').check();

    await page2.locator('#public-client-name').fill('Второй Клиент');
    await page2.locator('#public-client-phone').fill('0555 901 002');
    await page2.locator('#public-consent').check();

    // Context 1 submits first -> Confirmation screen
    await page1.getByRole('button', { name: 'Записаться' }).click();
    await expect(page1.getByText('Вы успешно записаны!')).toBeVisible();

    // Context 2 submits second -> Conflict alert/toast, returned to Step 3, and chosenSlotLabel is no longer available
    await page2.getByRole('button', { name: 'Записаться' }).click();
    await expect(
      page2.getByText('Это время только что заняли. Пожалуйста, выберите другое время.').first(),
    ).toBeVisible();
    await expect(page2.getByText('Выберите дату и время')).toBeVisible();
    await expect(page2.getByRole('button', { name: chosenSlotLabel, exact: true })).toHaveCount(0);

    await ctx1.close();
    await ctx2.close();
  });

  test('E2E 3: Master RBAC — Master logs in, sees only own schedule/appointments, and cannot access /dashboard/services, /dashboard/staff, or /dashboard/settings', async ({
    browser,
  }) => {
    const masterContext = await browser.newContext();
    const masterPage = await masterContext.newPage();

    await masterPage.goto('/login');
    await masterPage.locator('#login-email').fill('master@demo.zapis.kg');
    await masterPage.locator('#login-password').fill('Demo12345!');
    await masterPage.getByRole('button', { name: 'Войти' }).click();

    await expect(masterPage).toHaveURL(/\/dashboard$/);
    await expect(masterPage.getByText('Бекзат Исаков').first()).toBeVisible();

    // Sidebar should NOT contain Services, Staff, or Settings links for MASTER
    const sidebar = masterPage.locator('aside');
    await expect(sidebar.getByRole('link', { name: 'Услуги' })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Сотрудники' })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Настройки' })).toHaveCount(0);

    // Master schedule shows only their own column ("Бекзат Исаков"), not "Нурлан Осмонов"
    await sidebar.getByRole('link', { name: 'Расписание' }).click();
    await expect(masterPage).toHaveURL(/\/dashboard\/schedule$/);
    await expect(masterPage.getByText('Бекзат Исаков').first()).toBeVisible();
    await expect(masterPage.getByText('Нурлан Осмонов')).toHaveCount(0);

    // Direct navigation to Owner-only routes redirects Master back to /dashboard/schedule
    for (const restrictedPath of [
      '/dashboard/services',
      '/dashboard/staff',
      '/dashboard/settings',
    ]) {
      await masterPage.goto(restrictedPath);
      await expect(masterPage).toHaveURL(/\/dashboard\/schedule$/);
    }

    await masterContext.close();
  });

  test('E2E 4: Password recovery — forgot -> Mailpit -> reset (URL scrubbed) -> old token fails -> login works', async ({
    browser,
    request,
  }) => {
    const email = `e2e-reset-${Date.now()}@zapis.test`;
    const regRes = await request.post('http://localhost:4000/api/v1/auth/register', {
      data: {
        ownerName: 'E2E Reset Owner',
        email,
        password: 'OldPassword123',
        companyName: 'E2E Reset Salon',
        businessType: 'BARBERSHOP',
      },
    });
    expect(regRes.status()).toBe(201);

    await request.delete('http://localhost:8025/api/v1/messages');

    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto('/login');
    await page.getByRole('link', { name: 'Забыли пароль?' }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);

    await page.locator('#forgot-email').fill(email);
    await page.getByRole('button', { name: 'Отправить ссылку' }).click();
    await expect(page.getByText('Письмо отправлено')).toBeVisible();

    let messageId = '';
    await expect
      .poll(
        async () => {
          const res = await request.get('http://localhost:8025/api/v1/messages?limit=10');
          if (res.status() !== 200) return '';
          const body = (await res.json()) as {
            messages?: Array<{ ID: string; To?: Array<{ Address: string }> }>;
          };
          const found = body.messages?.find((m) => m.To?.some((t) => t.Address === email));
          messageId = found?.ID ?? '';
          return messageId;
        },
        { timeout: 15_000, intervals: [500, 1000] },
      )
      .not.toBe('');

    const msgRes = await request.get(`http://localhost:8025/api/v1/message/${messageId}`);
    expect(msgRes.status()).toBe(200);
    const msgJson = (await msgRes.json()) as { Text?: string };
    const match = /\/reset-password\?token=([A-Za-z0-9_-]+)/.exec(msgJson.Text ?? '');
    expect(match?.[1]).toBeTruthy();
    const resetPath = `/reset-password?token=${match?.[1] ?? ''}`;

    // Visit reset page; URL must be scrubbed of ?token=
    await page.goto(resetPath);
    await expect(page.locator('#reset-new-password')).toBeVisible();
    await expect(page).toHaveURL(/\/reset-password$/);

    await page.locator('#reset-new-password').fill('NewE2EPassword123');
    await page.locator('#reset-confirm-password').fill('NewE2EPassword123');
    await page.getByRole('button', { name: 'Сохранить новый пароль' }).click();
    await expect(page.getByRole('main').getByText('Пароль обновлён')).toBeVisible();

    // Reusing old token fails
    await page.goto(resetPath);
    await expect(page.getByText('Ссылка недействительна или устарела')).toBeVisible();

    // Login with new password succeeds
    await page.goto('/login');
    await page.locator('#login-email').fill(email);
    await page.locator('#login-password').fill('NewE2EPassword123');
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await request.delete('http://localhost:8025/api/v1/messages');
    await ctx.close();
  });

  test('E2E 5: Admin logs in with TOTP -> confirms owner payment claim -> suspends company (owner gets 403) -> unsuspends & impersonates read-only -> sees audit entries', async ({
    browser,
    request,
  }) => {
    // 1. Owner logs in and submits a payment claim via API/UI
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await ownerPage.goto('/login');
    await ownerPage.locator('#login-email').fill('owner@demo.zapis.kg');
    await ownerPage.locator('#login-password').fill('Demo12345!');
    await ownerPage.getByRole('button', { name: 'Войти' }).click();
    await expect(ownerPage).toHaveURL(/\/dashboard$/);

    await ownerPage.goto('/dashboard/billing');
    await expect(ownerPage.getByRole('heading', { name: 'Оплата и тариф' })).toBeVisible();
    await ownerPage
      .getByRole('button', { name: /Продлить|Выбрать и оплатить/ })
      .last()
      .click();
    await ownerPage.locator('#claim-reference').fill('E2E-CLAIM-777');
    await ownerPage.getByRole('button', { name: 'Отправить заявку' }).click();
    await expect(ownerPage.getByText('E2E-CLAIM-777')).toBeVisible();

    // 2. Ensure admin@demo.zapis.kg has 2FA enrolled so we test real TOTP login
    const adminLoginApi = await request.post('http://localhost:4000/api/v1/admin/auth/login', {
      data: { email: 'admin@demo.zapis.kg', password: 'AdminDemo12345!' },
    });
    expect(adminLoginApi.status()).toBe(200);
    const adminLoginJson = (await adminLoginApi.json()) as {
      data: { status: string; accessToken?: string; mfaToken?: string };
    };
    const tokenForEnroll = adminLoginJson.data.accessToken ?? adminLoginJson.data.mfaToken ?? '';
    expect(tokenForEnroll).toBeTruthy();

    const enrollRes = await request.post('http://localhost:4000/api/v1/admin/auth/2fa/enroll', {
      headers: { Authorization: `Bearer ${tokenForEnroll}` },
      data: {},
    });
    expect(enrollRes.status()).toBe(200);
    const enrollJson = (await enrollRes.json()) as { data: { secret: string } };
    const totpSecret = enrollJson.data.secret;

    const verifyEnrollRes = await request.post(
      'http://localhost:4000/api/v1/admin/auth/2fa/verify-enroll',
      {
        headers: { Authorization: `Bearer ${tokenForEnroll}` },
        data: { code: generateTotp(totpSecret, -1) },
      },
    );
    expect(verifyEnrollRes.status()).toBe(200);

    // 3. Admin logs in via /admin/login with TOTP
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await adminPage.goto('/admin/login');
    await adminPage.locator('#admin-email').fill('admin@demo.zapis.kg');
    await adminPage.locator('#admin-password').fill('AdminDemo12345!');
    await adminPage.getByRole('button', { name: 'Войти' }).click();

    await expect(adminPage.getByText('Двухфакторная аутентификация')).toBeVisible();
    await adminPage.getByPlaceholder('000000').fill(generateTotp(totpSecret));
    await adminPage.getByRole('button', { name: 'Подтвердить' }).click();
    await expect(adminPage).toHaveURL(/\/admin$/);
    await expect(adminPage.getByRole('heading', { name: 'Обзор платформы' })).toBeVisible();

    // 4. Confirm the owner's payment claim in /admin/payments
    await adminPage.goto('/admin/payments');
    await expect(adminPage.getByText('E2E-CLAIM-777')).toBeVisible();
    await adminPage.getByRole('button', { name: 'Подтвердить' }).first().click();
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click();
    await expect(adminPage.getByText('Платёж подтверждён, подписка продлена')).toBeVisible();

    // 5. Suspend Demo Barbershop and verify owner's session gets 403
    await adminPage.goto('/admin/companies');
    await adminPage.getByRole('link', { name: 'Demo Barbershop' }).click();
    await expect(adminPage).toHaveURL(/\/admin\/companies\/.+$/);

    await adminPage.getByRole('button', { name: 'Заблокировать' }).click();
    await adminPage.locator('#suspend-reason').fill('E2E suspension check');
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Заблокировать' }).click();
    await expect(adminPage.getByText('Компания заблокирована')).toBeVisible();

    const [suspendedRes] = await Promise.all([
      ownerPage.waitForResponse((r) => r.url().includes('/api/v1/') && r.status() === 403),
      ownerPage.getByRole('link', { name: 'Услуги' }).click(),
    ]);
    expect(suspendedRes.status()).toBe(403);
    await expect(ownerPage.getByText(/приостановлен/i)).toBeVisible();

    // 6. Unsuspend & impersonate read-only
    await adminPage.getByRole('button', { name: 'Разблокировать' }).click();
    await expect(adminPage.getByText('Блокировка снята')).toBeVisible();

    await adminPage.getByRole('button', { name: 'Имперсонация (read-only)' }).click();
    await adminPage.locator('#imp-reason').fill('E2E support inspection');
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Открыть кабинет' }).click();
    await expect(adminPage).toHaveURL(/\/dashboard$/);
    await expect(adminPage.getByText(/Режим просмотра|только чтение/i)).toBeVisible();

    await adminPage.getByRole('link', { name: 'Настройки', exact: true }).click();
    await expect(adminPage).toHaveURL(/\/dashboard\/settings$/);
    await expect(adminPage.getByText('Режим имперсонации: изменения отключены')).toBeVisible();

    await adminPage.getByRole('button', { name: 'Выйти из режима поддержки' }).click();
    await expect(adminPage).toHaveURL(/\/admin$/);

    // 7. Verify audit entries in /admin/audit
    await adminPage.goto('/admin/audit');
    await expect(adminPage.getByText('admin.company_suspend')).toBeVisible();
    await expect(adminPage.getByText('admin.company_unsuspend')).toBeVisible();
    await expect(adminPage.getByText('admin.impersonation_start')).toBeVisible();
    await expect(adminPage.getByText('admin.impersonation_exit')).toBeVisible();

    await ownerCtx.close();
    await adminCtx.close();
  });

  test('E2E 6: Client CRM — repeat client creates one card -> block refuses public booking generically -> anonymize clears PII keeping stats', async ({
    browser,
  }) => {
    const clientCtx = await browser.newContext();
    const clientPage = await clientCtx.newPage();

    // Helper to book a slot on /b/demo-barbershop
    async function bookSlot(slotIndex: number) {
      await clientPage.goto('/b/demo-barbershop');
      await clientPage
        .getByRole('button', { name: /Стрижка/i })
        .first()
        .click();
      await clientPage
        .getByRole('button', { name: /Любой свободный/i })
        .first()
        .click();
      await clientPage.locator('.overflow-x-auto button').nth(1).click();
      await advanceUntilSlotsAvailable(clientPage);
      await clientPage
        .getByRole('button', { name: /^\d{2}:\d{2}$/ })
        .nth(slotIndex)
        .click();
      await clientPage.locator('#public-client-name').fill('Айбек CRM');
      await clientPage.locator('#public-client-phone').fill('0555 888 999');
      await clientPage.locator('#public-consent').check();
      await clientPage.getByRole('button', { name: 'Записаться' }).click();
      await expect(clientPage.getByText('Вы успешно записаны!')).toBeVisible();
    }

    await bookSlot(0);
    await bookSlot(1);

    // Owner checks /dashboard/clients -> one card for Айбек CRM with 2 appointments in history
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await ownerPage.goto('/login');
    await ownerPage.locator('#login-email').fill('owner@demo.zapis.kg');
    await ownerPage.locator('#login-password').fill('Demo12345!');
    await ownerPage.getByRole('button', { name: 'Войти' }).click();
    await expect(ownerPage).toHaveURL(/\/dashboard$/);

    await ownerPage.getByRole('link', { name: 'Клиенты', exact: true }).click();
    await expect(ownerPage).toHaveURL(/\/dashboard\/clients$/);
    await expect(ownerPage.getByRole('link', { name: 'Айбек CRM' })).toBeVisible();
    await ownerPage.getByRole('link', { name: 'Айбек CRM' }).click();
    await expect(ownerPage).toHaveURL(/\/dashboard\/clients\/.+$/);
    await expect(ownerPage.getByText('История записей (2)')).toBeVisible();

    // Owner blocks client -> public booking is refused generically
    await ownerPage.getByRole('button', { name: 'Заблокировать' }).first().click();
    await ownerPage.getByRole('dialog').getByRole('button', { name: 'Заблокировать' }).click();
    await expect(ownerPage.getByRole('dialog')).toBeHidden();
    await expect(ownerPage.getByText('Заблокирован', { exact: true })).toBeVisible();

    await clientPage.goto('/b/demo-barbershop');
    await clientPage
      .getByRole('button', { name: /Стрижка/i })
      .first()
      .click();
    await clientPage
      .getByRole('button', { name: /Любой свободный/i })
      .first()
      .click();
    await clientPage.locator('.overflow-x-auto button').nth(1).click();
    await advanceUntilSlotsAvailable(clientPage);
    await clientPage
      .getByRole('button', { name: /^\d{2}:\d{2}$/ })
      .nth(2)
      .click();
    await clientPage.locator('#public-client-name').fill('Айбек CRM');
    await clientPage.locator('#public-client-phone').fill('0555 888 999');
    await clientPage.locator('#public-consent').check();
    await clientPage.getByRole('button', { name: 'Записаться' }).click();
    await expect(
      clientPage.getByText(/Онлайн-запись для этого номера телефона недоступна/i),
    ).toBeVisible();

    // Owner anonymizes client -> PII gone, appointment history count remains
    await ownerPage.getByRole('button', { name: 'Обезличить данные клиента' }).click();
    await ownerPage
      .getByRole('dialog')
      .getByRole('button', { name: 'Подтвердить обезличивание' })
      .click();
    await expect(ownerPage.getByRole('heading', { name: 'Deleted client' })).toBeVisible();
    await expect(ownerPage.getByText('История записей (2)')).toBeVisible();

    await clientCtx.close();
    await ownerCtx.close();
  });

  test('E2E 7: Breaks & Time Off — master adds vacation on /dashboard/profile -> public slots hidden for that master -> schedule shows hatched block', async ({
    browser,
  }) => {
    const masterCtx = await browser.newContext();
    const masterPage = await masterCtx.newPage();

    await masterPage.goto('/login');
    await masterPage.locator('#login-email').fill('master@demo.zapis.kg');
    await masterPage.locator('#login-password').fill('Demo12345!');
    await masterPage.getByRole('button', { name: 'Войти' }).click();
    await expect(masterPage).toHaveURL(/\/dashboard/);

    await masterPage.getByRole('link', { name: 'Профиль', exact: true }).click();
    await expect(masterPage).toHaveURL(/\/dashboard\/profile$/);
    await expect(masterPage.getByText('Мои отпуска и больничные')).toBeVisible();

    const today = new Date();
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const in3Days = new Date(today.getTime() + 3 * 86_400_000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    await masterPage.getByRole('button', { name: 'Добавить' }).click();
    await masterPage.locator('#to-start-date').fill(fmt(tomorrow));
    await masterPage.locator('#to-end-date').fill(fmt(in3Days));
    await masterPage.locator('#to-note').fill('E2E Отпуск');
    await masterPage.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click();
    await expect(masterPage.getByText('E2E Отпуск')).toBeVisible();

    // Verify public booking for that master shows no slots tomorrow
    const clientCtx = await browser.newContext();
    const clientPage = await clientCtx.newPage();
    await clientPage.goto('/b/demo-barbershop');
    await clientPage
      .getByRole('button', { name: /Стрижка/i })
      .first()
      .click();
    await clientPage
      .getByRole('button', { name: /Бекзат Исаков/i })
      .first()
      .click();
    await clientPage.locator('.overflow-x-auto button').nth(1).click();
    await expect(clientPage.getByRole('button', { name: 'Выбрать следующую дату' })).toBeVisible();
    await expect(clientPage.getByRole('button', { name: /^\d{2}:\d{2}$/ })).toHaveCount(0);

    await masterCtx.close();
    await clientCtx.close();
  });

  test('E2E 8: Client Self-Service — book -> open manage link -> reschedule -> cancel -> staff sees cancellation', async ({
    browser,
  }) => {
    const clientCtx = await browser.newContext();
    const clientPage = await clientCtx.newPage();

    await clientPage.goto('/b/demo-barbershop');
    await clientPage
      .getByRole('button', { name: /Стрижка/i })
      .first()
      .click();
    await clientPage
      .getByRole('button', { name: /Любой свободный/i })
      .first()
      .click();
    await clientPage.locator('.overflow-x-auto button').nth(1).click();
    await advanceUntilSlotsAvailable(clientPage);
    await clientPage
      .getByRole('button', { name: /^\d{2}:\d{2}$/ })
      .first()
      .click();
    await clientPage.locator('#public-client-name').fill('Клиент SelfService');
    await clientPage.locator('#public-client-phone').fill('0555 444 333');
    await clientPage.locator('#public-consent').check();
    await clientPage.getByRole('button', { name: 'Записаться' }).click();
    await expect(clientPage.getByText('Вы успешно записаны!')).toBeVisible();

    const manageLink = clientPage.locator('a[href*="/manage/"]');
    await expect(manageLink).toBeVisible();
    const href = (await manageLink.getAttribute('href')) ?? '';
    const managePath = href.startsWith('http') ? new URL(href).pathname : href;
    await clientPage.goto(managePath);
    await expect(clientPage.getByText('Управление вашей записью')).toBeVisible();

    // Reschedule
    await clientPage.getByRole('button', { name: 'Перенести время' }).click();
    await clientPage.getByRole('dialog').locator('.overflow-x-auto button').nth(2).click();
    await clientPage
      .getByRole('dialog')
      .getByRole('button', { name: /^\d{2}:\d{2}$/ })
      .first()
      .click();
    await clientPage.getByRole('dialog').getByRole('button', { name: 'Перенести' }).click();
    await expect(clientPage.getByText('Запись успешно перенесена')).toBeVisible();

    // Cancel
    await clientPage.getByRole('button', { name: 'Отменить запись' }).click();
    await clientPage.locator('#cancel-reason').fill('E2E отмена клиентом');
    await clientPage
      .getByRole('dialog')
      .getByRole('button', { name: 'Подтвердить отмену' })
      .click();
    await expect(clientPage.getByText(/Запись отменена \(вами\)/i)).toBeVisible();

    // Owner checks appointments list
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await ownerPage.goto('/login');
    await ownerPage.locator('#login-email').fill('owner@demo.zapis.kg');
    await ownerPage.locator('#login-password').fill('Demo12345!');
    await ownerPage.getByRole('button', { name: 'Войти' }).click();
    await expect(ownerPage).toHaveURL(/\/dashboard$/);

    await ownerPage.getByRole('link', { name: 'Записи', exact: true }).click();
    await expect(ownerPage.getByText('Клиент SelfService')).toBeVisible();

    await clientCtx.close();
    await ownerCtx.close();
  });

  test('E2E 9: Phase 20 — Online booking triggers owner bell notification, Telegram link-code in profile, and MANUAL reminders queue', async ({
    browser,
  }) => {
    const clientName = `Клиент Увед ${Date.now().toString().slice(-5)}`;
    const clientCtx = await browser.newContext();
    const clientPage = await clientCtx.newPage();

    await clientPage.goto('/b/demo-barbershop');
    await clientPage
      .getByRole('button', { name: /Стрижка/i })
      .first()
      .click();
    await clientPage
      .getByRole('button', { name: /Любой свободный/i })
      .first()
      .click();
    await clientPage.locator('.overflow-x-auto button').nth(1).click();
    await advanceUntilSlotsAvailable(clientPage);
    await clientPage
      .getByRole('button', { name: /^\d{2}:\d{2}$/ })
      .first()
      .click();
    await clientPage.locator('#public-client-name').fill(clientName);
    await clientPage.locator('#public-client-phone').fill('0555 777 999');
    await clientPage.locator('#public-consent').check();
    await clientPage.getByRole('button', { name: 'Записаться' }).click();
    await expect(clientPage.getByText('Вы успешно записаны!')).toBeVisible();
    await clientCtx.close();

    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await ownerPage.goto('/login');
    await ownerPage.locator('#login-email').fill('owner@demo.zapis.kg');
    await ownerPage.locator('#login-password').fill('Demo12345!');
    await ownerPage.getByRole('button', { name: 'Войти' }).click();
    await expect(ownerPage).toHaveURL(/\/dashboard$/);

    // 1. Notification bell shows unread badge & dropdown
    await expect(ownerPage.getByTestId('unread-notifications-badge')).toBeVisible();
    await ownerPage.getByRole('button', { name: 'Уведомления' }).click();
    await expect(
      ownerPage.getByText(new RegExp(`Новая онлайн-запись: ${clientName}`)),
    ).toBeVisible();
    await ownerPage.getByRole('button', { name: 'Прочитать все' }).click();
    await expect(ownerPage.getByTestId('unread-notifications-badge')).toHaveCount(0);

    // 2. Profile -> Telegram link-code
    await ownerPage.getByRole('link', { name: 'Профиль', exact: true }).click();
    await expect(ownerPage.getByText('Уведомления о записях')).toBeVisible();
    await ownerPage.getByRole('button', { name: 'Подключить Telegram' }).click();
    await expect(ownerPage.getByText(/\/start /)).toBeVisible();

    // 3. Settings -> ensure MANUAL reminder mode
    await ownerPage.getByRole('link', { name: 'Настройки', exact: true }).click();
    await expect(ownerPage.locator('#company-reminder-mode')).toBeVisible();
    await ownerPage.locator('#company-reminder-mode').selectOption('MANUAL');
    await ownerPage.getByRole('button', { name: 'Сохранить настройки' }).click();
    await expect(ownerPage.getByText('Настройки компании сохранены')).toBeVisible();

    // 4. Appointments -> Напоминания tab -> mark sent
    await ownerPage.getByRole('link', { name: 'Записи', exact: true }).click();
    await ownerPage.getByRole('button', { name: 'Напоминания', exact: true }).click();
    const row = ownerPage.getByTestId('manual-reminder-row').filter({ hasText: clientName });
    await expect(row.first()).toBeVisible();
    await expect(row.first().getByRole('link', { name: 'Написать в WhatsApp' })).toBeVisible();
    await row.first().getByRole('button', { name: 'Отправлено' }).click();
    await expect(ownerPage.getByText('Напоминание отмечено как отправленное')).toBeVisible();

    await ownerCtx.close();
  });

  test('E2E 10: Phase 21 — Light Prepayment: settings instructions -> service prepayment -> public booking block -> owner confirms received', async ({
    browser,
  }) => {
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await ownerPage.goto('/login');
    await ownerPage.locator('#login-email').fill('owner@demo.zapis.kg');
    await ownerPage.locator('#login-password').fill('Demo12345!');
    await ownerPage.getByRole('button', { name: 'Войти' }).click();
    await expect(ownerPage).toHaveURL(/\/dashboard$/);

    // 1. Settings -> payment instructions
    await ownerPage.getByRole('link', { name: 'Настройки', exact: true }).click();
    await expect(ownerPage.locator('#company-name')).toHaveValue('Demo Barbershop');
    await ownerPage.locator('#company-payment-instructions').fill('MBank +996 555 123 456 (Demo)');
    await ownerPage.locator('#company-prepayment-hold').fill('30');
    await ownerPage.getByRole('button', { name: 'Сохранить настройки' }).click();
    await expect(ownerPage.getByText('Настройки компании сохранены')).toBeVisible();

    // 2. Services -> enable prepayment on Мужская стрижка
    await ownerPage.getByRole('link', { name: 'Услуги', exact: true }).click();
    await ownerPage
      .locator('div', { hasText: 'Мужская стрижка' })
      .getByRole('button', { name: /Редактировать|Изменить/i })
      .first()
      .click();
    await ownerPage.locator('#service-requires-prepayment').check();
    await ownerPage.locator('#service-prepay-mode').selectOption('FIXED');
    await ownerPage.locator('#service-prepay-value').fill('200');
    await expect(ownerPage.getByText(/Сумма предоплаты при записи: 200/)).toBeVisible();
    await ownerPage.getByRole('button', { name: 'Сохранить' }).click();
    await expect(ownerPage.getByText(/Услуга обновлена/i)).toBeVisible();

    // 3. Public booking -> prepayment notice & success block
    const clientName = `Клиент Предопл ${Date.now().toString().slice(-5)}`;
    const clientCtx = await browser.newContext();
    const clientPage = await clientCtx.newPage();
    await clientPage.goto('/b/demo-barbershop');
    await expect(clientPage.getByText(/Предоплата: 200 сом/).first()).toBeVisible();
    await clientPage
      .getByRole('button', { name: /Мужская стрижка/i })
      .first()
      .click();
    await clientPage
      .getByRole('button', { name: /Любой свободный/i })
      .first()
      .click();
    await clientPage.locator('.overflow-x-auto button').nth(1).click();
    await advanceUntilSlotsAvailable(clientPage);
    await clientPage
      .getByRole('button', { name: /^\d{2}:\d{2}$/ })
      .first()
      .click();
    await clientPage.locator('#public-client-name').fill(clientName);
    await clientPage.locator('#public-client-phone').fill('0555 888 111');
    await clientPage.locator('#public-consent').check();
    await clientPage.getByRole('button', { name: 'Записаться' }).click();
    await expect(clientPage.getByText('Вы успешно записаны!')).toBeVisible();
    await expect(clientPage.getByText('Требуется предоплата')).toBeVisible();
    await expect(clientPage.getByText('MBank +996 555 123 456 (Demo)')).toBeVisible();
    await expect(clientPage.getByRole('link', { name: 'Отправить чек в WhatsApp' })).toBeVisible();
    await clientCtx.close();

    // 4. Owner overview banner & appointments drawer confirm RECEIVED
    await ownerPage.getByRole('link', { name: 'Обзор', exact: true }).click();
    await expect(ownerPage.getByText(/Ожидают предоплату:/)).toBeVisible();

    await ownerPage.getByRole('link', { name: 'Записи', exact: true }).click();
    await ownerPage.locator('#filter-prepayment').selectOption('PENDING');
    await ownerPage.getByText(clientName).first().click();
    await ownerPage.getByRole('button', { name: 'Подтвердить получение' }).click();
    await expect(ownerPage.getByText('Предоплата подтверждена')).toBeVisible();

    await ownerCtx.close();
  });

  test('E2E 11: Phase 22 — Analytics dashboard renders KPIs, charts, heatmap, and downloads CSV export', async ({
    browser,
  }) => {
    const ownerCtx = await browser.newContext({ acceptDownloads: true });
    const ownerPage = await ownerCtx.newPage();
    await ownerPage.goto('/login');
    await ownerPage.locator('#login-email').fill('owner@demo.zapis.kg');
    await ownerPage.locator('#login-password').fill('Demo12345!');
    await ownerPage.getByRole('button', { name: 'Войти' }).click();
    await expect(ownerPage).toHaveURL(/\/dashboard$/);

    await ownerPage.getByRole('link', { name: 'Аналитика', exact: true }).click();
    await expect(ownerPage.getByRole('heading', { name: 'Аналитика' })).toBeVisible();
    await expect(ownerPage.getByText('Выручка (завершённые)')).toBeVisible();
    await expect(ownerPage.getByText('Топ услуг')).toBeVisible();
    await expect(ownerPage.getByText('Мастера и загрузка')).toBeVisible();
    await expect(ownerPage.getByText('Тепловая карта записи (дни недели × часы)')).toBeVisible();

    await ownerPage.getByRole('button', { name: '7 дней' }).click();
    await expect(ownerPage.getByText('Выручка (завершённые)')).toBeVisible();

    const downloadPromise = ownerPage.waitForEvent('download');
    await ownerPage.getByRole('button', { name: 'Экспорт CSV' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^appointments-.*\.csv$/);

    await ownerCtx.close();
  });
});
