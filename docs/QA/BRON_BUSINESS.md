# QA Report: Phase 6 (Business Features) & Phase 7 (Production Readiness)

## 1. Сводка реализованных изменений (`DEC-047`)

- **Трёхъязычная локализация (`RU` / `KY` / `EN`)**:
  - Миграция `20261119200000_business_features_en_locale_branding_domains` добавила `EN` в `enum Locale`.
  - Публичный словарь `frontend/src/lib/i18n/public-dict.ts` содержит `92` ключа в `ru`, `ky` и `en` (проверяется скриптом `frontend/scripts/check-i18n-parity.mjs`).
  - Публичная страница записи `/b/[slug]` и страница управления записью `/manage/[token]` поддерживают переключение `Рус / Кыр / Eng` (`PublicLangSwitcher`) и инициализируются из `company.defaultLocale`.
  - Шаблоны уведомлений (`notifications/templates/index.ts`), очередь напоминаний (`reminders.service.ts`) и блок предоплаты (`appointments/prepayment.ts`) формируют тексты на `RU`, `KY` и `EN`.
  - В шапке кабинета (`DashboardShell`) добавлен переключатель языка навигации и оболочки `RU` / `KY` / `EN` (`data-testid="dashboard-lang-select"`, `dashboard-lang.ts`, по умолчанию `ru`).
- **Публичный брендинг и собственные домены**:
  - Модель `Company` расширена полями `description` (`<= 500` симв.), `brandColor` (`#RRGGBB`, `Company_brandColor_hex_check`), `instagramUrl` и `customDomain` (`@unique`, `Company_customDomain_format_check`).
  - Установка непустого `customDomain` защищена тарифным флагом `featureCustomBranding` (`402 FEATURE_NOT_IN_PLAN` на `FREE`/`BUSINESS`, доступно на `PRO`) и проверяет уникальность (`409 CONFLICT`).
  - Добавлен публичный маршрут `GET /api/v1/public/domains/:domain` для разрешения компании по привязанному домену.
  - На `/dashboard/settings` добавлены поля описания, Instagram, акцентного цвета и собственного домена; на `/b/[slug]` отображаются описание, кнопка Instagram и фирменный цвет акцента.
- **Тёмная тема (Dark Mode)**:
  - Подключён `ThemeProvider` (`next-themes`, `attribute="class"`) в `frontend/src/app/layout.tsx`, добавлены CSS-переменные `.dark` и `.dark .workspace-shell` в `globals.css`, а также кнопка переключения темы `data-testid="theme-toggle"` в шапке кабинета.
- **Экспорт журнала платежей CSV**:
  - Добавлен маршрут `GET /api/v1/export/payments.csv` (`OWNER`) с UTF-8 BOM и защитой от CSV-инъекций (`sanitizeCsvCell`) и кнопка «Экспорт платежей CSV» на `/dashboard/analytics`.

## 2. Результаты проверок (Phase 6 & Phase 7 Production Readiness)

1. **Проверка паритета словарей i18n**:
   - `node frontend/scripts/check-i18n-parity.mjs` → `i18n parity OK (92 keys in ru, ky, and en)` (exit `0`).
2. **Полный Quality Gate (`npm run format && npm run gate`)**:
   - `typecheck`: ok (`4.5s`)
   - `lint`: ok (`9.4s`, `--max-warnings 0`)
   - `test`: ok (`46` тестовых файлов / `205` тестов Vitest пройдено, включая `tests/integration/business-features-phase6.test.ts` — `3/3`)
   - `build`: ok (`6.9s`)
   - `guard`: ok (`0.1s`)
3. **Резервное копирование и миграция локальной dev-БД `zapis` без сброса**:
   - Создан дамп `.tmp/bron-phase6-business/before.dump` (`pg_restore --list` → `246` записей TOC).
   - Выполнена `NODE_ENV=development npx prisma migrate deploy` → применена `26`-я миграция `20261119200000_business_features_en_locale_branding_domains`.
   - Сверка `diff -u rows.before rows.after` по всем бизнес-таблицам пуста (`0` расхождений).
4. **Браузерные E2E-тесты Playwright Chromium (против `zapis_test`)**:
   - Прогнаны все `10` целевых E2E-сценариев (`e2e/business-features.spec.ts`, `e2e/saas-billing.spec.ts`, `e2e/payments.spec.ts`, `e2e/crm.spec.ts`, `e2e/core-booking.spec.ts`, `e2e/multi-company.spec.ts`, `e2e/sessions.spec.ts`) → **`10 passed (10.5s)`**, `0` ошибок консоли и `pageerror`.
   - Скриншоты `artifacts/bron-business/dashboard-dark.png`, `artifacts/bron-business/public-en-desktop.png` (`1440x900`) и `artifacts/bron-business/public-en-mobile.png` (`360x800`) проверены визуально (`scrollWidth <= innerWidth`).
