import { expect, type Page, test } from '@playwright/test';

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

    await page2.locator('#public-client-name').fill('Второй Клиент');
    await page2.locator('#public-client-phone').fill('0555 901 002');

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
});
