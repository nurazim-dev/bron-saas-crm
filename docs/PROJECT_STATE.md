# Project State (PROJECT_STATE.md)

## Update 2026-11-19 — Умный Telegram-бот («второй веб») для владельца, мастеров и клиентов (`DEC-048`)

Реализован и проверен интерактивный Telegram-бот для персонала и клиентов:
- уведомления о новых/перенесённых/отменённых записях приходят с inline-кнопками действий всем `OWNER`/`MANAGER` салона и конкретному назначенному мастеру (`masterId`);
- на странице `/dashboard/staff` владелец видит статус Telegram каждого сотрудника и может сгенерировать одноразовую ссылку привязки (`POST /api/v1/staff/:id/telegram-link-code`) для мастера даже без email/логина от веб-кабинета;
- сотрудник в Telegram-боте может открывать расписание (`/today`, `/tomorrow`, `/upcoming`), менять статусы записей кнопками (`Подтвердить`, `Начать`, `Завершить`, `Не пришёл`, `Отменить`), смотреть сводку за день (`/stats`), переключать активную компанию (`/companies`), ставить пуши на паузу (`/settings`) и очищать чат (`/clear`);
- клиент после записи на `/b/[slug]` и на `/manage/[token]` может в 1 клик подключить Telegram-бота (`/start client_<manageToken>`), смотреть и отменять свои записи в боте и бесплатно получать авто-напоминания за 24ч и 2ч в Telegram.
Миграция `20261119210000_telegram_smart_bot_and_client_chat` применена к `zapis_test` и после backup к `zapis` (`27` миграций, 0 потерь данных). `npm run gate` (`47` файлов / `207` тестов) завершился с кодом `0`.

## Update 2026-11-19 — Phase 6 (Business Features) и Phase 7 (Production Readiness) завершены

Реализованы и проверены все требования Phase 6 Business Features и Phase 7 Production Readiness (`DEC-047`):
- трёхъязычная локализация `RU` / `KY` / `EN` для публичной записи `/b/[slug]`, страницы `/manage/[token]`,
  шаблонов уведомлений/WhatsApp/предоплаты (`92` ключа в `public-dict.ts`, `check-i18n-parity.mjs` exit `0`)
  и переключатель языка `RU`/`KY`/`EN` в шапке кабинета (`dashboard-lang.ts`);
- брендинг компании (`description`, `brandColor`, `instagramUrl`) и привязка `customDomain` (`@unique`,
  защищена флагом `featureCustomBranding` на тарифе `PRO` и маршрутом `GET /api/v1/public/domains/:domain`);
- тёмная тема кабинета (`ThemeProvider`, класс `.dark`, переключатель `data-testid="theme-toggle"`);
- выгрузка журнала платежей `GET /api/v1/export/payments.csv` с защитой от формул и кнопкой в `/dashboard/analytics`.
Миграция `20261119200000_business_features_en_locale_branding_domains` применена к `zapis_test` и после backup
(`.tmp/bron-phase6-business/before.dump`, `246` записей TOC) к `zapis` (`26` миграций, контрольные суммы 1:1).
`npm run gate` (`46` файлов / `205` тестов) и полный набор Playwright Chromium (`10` сценариев против `zapis_test`)
завершились с кодом `0`. Все тестовые процессы остановлены.
Отчёт: [BRON_BUSINESS](QA/BRON_BUSINESS.md).

## Update 2026-11-19 — Phase 5 (SaaS Monetization) завершена

Реализованы и проверены все требования Phase 5 SaaS Monetization (`DEC-046`):
- матрица тарифов `FREE` / `BUSINESS` / `PRO` в БД с описанием, квотами (`maxStaff`, `maxServices`,
  `maxAppointmentsPerMonth`, `maxRemindersPerMonth`) и флагами (`featureAnalytics`, `featureAutoReminders`,
  `featurePrepayment`, `featureCrmAdvanced`, `featureManualPayments`, `featureMultiCompany`,
  `featureCustomBranding`);
- архивирование `START` (`isLegacy=true`, `isPublic=false`, `isActive=true`) без потери прав и продлений
  у существующих компаний;
- серверная проверка лимитов и фич (`402 PLAN_LIMIT_REACHED` / `FEATURE_NOT_IN_PLAN`), счётчики в
  `GET /api/v1/billing`, перевод на `FREE` через `POST /api/v1/billing/switch-free` (включая `LOCKED`)
  без потери данных и защита заявок от `FREE`/чужих архивных планов;
- обновление UI `/dashboard/billing`, `/admin/plans` и лендинга.
Миграция `20261119190000_saas_plan_matrix_and_limits` применена к `zapis_test` и после backup к `zapis`
(`25` миграций, контрольные суммы 1:1, действующие `5 BUSINESS` и `2 PRO` подписки сохранены).
`npm run gate` (`45` файлов / `202` теста) и Playwright Chromium (`9` сценариев против `zapis_test`)
завершились с кодом `0`.
Phase 5 (SaaS Monetization) закрыта; отчёт: [BRON_SAAS](QA/BRON_SAAS.md).

## Update 2026-11-19 — Phase 4 (Manual Payments) завершена

Реализованы и проверены все требования Phase 4 Manual Payments (`DEC-045`):
- раздельная модель ручного учёта оплат бизнеса (`BusinessPayment`: `PAYMENT`/`PREPAYMENT`/`REFUND`,
  статусы `PENDING`/`CONFIRMED`/`REJECTED`/`VOIDED`) и `ManualPaymentProvider` без внешних платёжных API;
- приватное хранилище чеков `PaymentProof` в PostgreSQL для заявок подписки и оплат услуг
  (перекодирование изображений в WebP через `sharp`, проверка PDF без активного контента,
  до 5 файлов на платёж / 50 МБ на компанию, выдача только через авторизованные endpoint с `no-store`);
- загрузка чека не подтверждает оплату автоматически; `POST /billing/payments/:id/proofs`
  доступен в режиме `LOCKED`; `PlatformAdmin` видит только чеки подписки;
- кабинет владельца `/dashboard/payments`, загрузка/просмотр чеков в `/dashboard/billing` и
  `/admin/payments`, а также отдельная сверка `Подтверждённые поступления` на `/dashboard/analytics`.
Миграция `20261119180000_manual_payments_business_and_proofs` применена к `zapis_test` и после backup
к `zapis` (`24` миграции, контрольные суммы 1:1). `npm run gate` (`44` файла / `199` тестов)
и Playwright Chromium (`8` сценариев против `zapis_test`) завершились с кодом `0`.
Phase 4 (Manual Payments) закрыта; отчёт: [BRON_PAYMENTS](QA/BRON_PAYMENTS.md).

## Update 2026-11-19 — Phase 3 (CRM) завершена

Реализованы и проверены все требования Phase 3 CRM (`DEC-044`):
- теги клиентов (`ClientTag`, `ClientTagAssignment`), сегменты (`NEW`, `REPEAT`, `VIP`,
  `AT_RISK`, `LOST`, `NO_SHOW_RISK`, `BLOCKED`) и сортировка по сумме визитов;
- недеструктивное объединение дубликатов клиентов (`preview -> execute` под `FOR UPDATE`)
  с сохранением всех записей/тегов/блокировок и освобождением телефона;
- CSV-импорт (`preview -> execute`, до 500 строк) со строгой tenant-изоляцией и экспорт
  `/api/v1/export/clients.csv` с защитой формул;
- глобальный поиск `GET /api/v1/search` (`⌘K` в шапке кабинета), а также `GET /analytics/crm`
  и отчёт CRM в `/dashboard/analytics` с пометкой `COMPLETED_VISITS_ESTIMATE`.
Миграция `20261119170000_crm_tags_and_merge_support` применена к `zapis_test` и после backup
к `zapis` (`23` миграции, контрольные суммы 1:1). `npm run gate` (`43` файла / `197` тестов)
и Playwright Chromium (`7` сценариев против `zapis_test`) завершились с кодом `0`.
Phase 3 (CRM) закрыта; отчёт: [BRON_CRM](QA/BRON_CRM.md).

## Update 2026-11-19 — Phase 2 (Core Booking) завершена

Реализованы и проверены все требования Core Booking (`DEC-043`):
- персональные цены и длительности услуг мастеров (`MasterService.customPrice`,
  `customDurationMin`) в staff UI/API, публичном профиле и поиске слотов (включая `ANY`);
- пакеты/комплексы услуг (`ServicePackage`, `ServicePackageItem`) с CRUD в `/dashboard/services`,
  бронированием из кабинета и на `/b/[slug]` (RU/KY) и пропорциональной выручкой (`DEC-035`);
- расширенные статусы `CONFIRMED` и `IN_PROGRESS` с таблицей переходов, обновлением
  `Appointment_no_overlapping_active_slots`, календаря, дашборда и `/manage/[token]`.
Миграции `20261119160000_*` и `20261119160500_*` применены к `zapis_test` и после backup
к `zapis` (`22` миграции, контрольные суммы 1:1). `npm run gate` (`42` файла / `193` теста)
и Playwright Chromium (`9` сценариев против `zapis_test`) завершились с кодом `0`.
Phase 2 (Core Booking) закрыта; отчёт: [BRON_CORE_BOOKING](QA/BRON_CORE_BOOKING.md).

## Update 2026-11-19 — Foundation завершена (multi-company Identity)

Реализованы общая учётная запись `Identity` для нескольких компаний, создание
дополнительной компании из кабинета и явное переключение (`POST /auth/companies`,
`POST /auth/switch-company`, `GET /api/v1/auth/companies`). Сохранены существующие
`User.id` и связи, защищён общий аккаунт от смены кредов владельцем другой
компании (`409 SHARED_IDENTITY`), на фронтенде добавлен `CompanySwitcher`,
отмена запросов прежней компании и сброс UI-состояния при переключении.
Миграция `20261119150000_identity_memberships` применена к `zapis_test` и после
backup к `zapis` с проверкой контрольных сумм (`8` `Identity`, `0` расхождений).
`npm run gate` (`190` тестов / `41` файл) и целевой Chromium-набор (`8` сценариев)
завершились с кодом `0`. Foundation закрыта; отчёт:
[BRON_MULTICOMPANY](QA/BRON_MULTICOMPANY.md).

## Update 2026-11-19 — Foundation, роль менеджера

Владелец приглашает менеджера через форму сотрудников. Менеджер ведёт записи и
расписание всей своей компании, читает карточки клиентов и получает только данные
сотрудников, необходимые для записи. Права владельца на управление сотрудниками,
тарифом и настройками сохранены. Миграция применена к локальным dev и test.
Foundation остаётся открытой: нужны общая учётная запись владельца и переключение
между компаниями. Подробности в [отчёте BRON_MANAGER](QA/BRON_MANAGER.md).

## Update 2026-11-17 — последовательное выполнение нового master prompt

Пользователь разрешил все фазы подряд без подтверждения между ними (DEC-037).
В Foundation реализованы серверные сессии и UI устройств, отзыв access/refresh,
ротация с защитой от replay, подтверждение email, приглашения сотрудников через
outbox с самостоятельной установкой пароля. Старые refresh без sid требуют входа.
Две добавочные миграции применены к dev после backup: 7 компаний, 10 пользователей,
17 записей сохранены. Сессии/verification/invitation проверены на тестовой БД.
Повторное перетаскивание проверено обычными событиями мыши с промежуточным dragover;
прежний отказ автоматического жеста больше не воспроизводится в сценарии теста.
Статус нового плана: Foundation остаётся открытой (MANAGER, multi-company identity),
Core Booking открыта (статусы, пакеты, цены мастеров), фазы 3–7 требуют расширений.
Исторические галочки фаз 0–26 ниже относятся к прежнему ТЗ.
Подробности: [BRON_AUTOPILOT](QA/BRON_AUTOPILOT.md).

## История: 2026-11-17 — BRON Phase 2, перенос в календаре

Добавлен drag/drop в дневной сетке с подтверждением и серверной обработкой
ошибок; стоимость/состав сохраняются. На телефоне и с клавиатуры доступна форма.
Gate: 173 tests, typecheck/lint/build/guard exit 0; финальная сборка и frontend lint
повторены после изменения drop-handler. Chromium calendar: 2 passed.
Повторный нативный drag при прокрутке нестабилен в автоматическом тесте;
проверка конфликта выполнена dispatchEvent и настоящим HTTP 409.
Полная готовность drag-and-drop не заявляется. См. [BRON_DRAG](QA/BRON_DRAG.md).

## Update 2026-11-17 — BRON Phase 2, несколько услуг

Реализованы состав визита AppointmentService, выбор до 10 услуг у одного мастера,
общие цена/длительность/предоплата, проверка полного интервала и ANY-master,
снимки состава и перенос без изменения цены/длительности. Обновлены staff-форма,
публичный RU/KY выбор, CRM-история, напоминания и аналитика услуг.
Gate: exit 0, 173 backend tests / 36 files; Chromium: 4 passed.
Локальная миграция применена после backup: 17 старых записей сохранены,
суммы/длительность совпали, snapshots заполнены, EXCLUDE проверен.
Отчёт: [BRON_MULTISERVICE](QA/BRON_MULTISERVICE.md).
Phase 2 остаётся открытой: пакеты, цены мастеров, новые статусы и drag-and-drop.

## История: 2026-11-17 — BRON Phase 2, календарь

По явному запросу пользователя начата Phase 2 до полного завершения Foundation.
Добавлены день/неделя/месяц, мобильный список, фильтр услуг, загрузка всех страниц
периода, динамический диапазон дневной сетки и доступные диалоги записи.
Новые расширенные статусы, несколько услуг, пакеты и drag-and-drop ещё не реализованы;
полная Core Booking остаётся открытой. Foundation также не закрыта.
Отчёт: [BRON_PHASE2](QA/BRON_PHASE2.md).

## Update 2026-11-17 — BRON Foundation, начальный инкремент

Новый master prompt: инвентаризация и семифазный план в
[BRON_ROADMAP.md](BRON_ROADMAP.md). Phase 1 НЕ завершена: нужны серверные
сессии, подтверждение email, приглашения, MANAGER и multi-company membership.
В текущем инкременте: tenant scope в authenticate/refresh, атомарная смена
пароля с compare-and-swap и аудитом, регрессионные проверки гонки и rollback.
Существующие незакоммиченные изменения сохранены. Production не менялся.
Gate: exit 0, 166 тестов / 35 файлов; отчёт [BRON_FOUNDATION](QA/BRON_FOUNDATION.md).

## Update 2026-11-17 — U2–U5

Staff portfolio/media API and owner editor, public master details/hours, RU/KY
booking/manage flow and ICS export are implemented. Telegram confirmation is queued
transactionally; link consumption and update deduplication are atomic. Media migration
has been applied without resetting the dev database. Details and limitations:
[docs/QA/U5.md](QA/U5.md). Gate: 163 backend tests, typecheck/lint/build/guard passed.

## Phase Checklist

- [x] **Phase 0**: Foundation & Tooling
- [x] **Phase 1**: Database & Prisma
- [x] **Phase 2**: Auth, Company & RBAC (Backend)
- [x] **Phase 3**: Services, Staff & Working Hours (Backend)
- [x] **Phase 4**: Appointments & Double-Booking Protection (Backend)
- [x] **Phase 5**: Availability Engine & Public Booking API (Backend)
- [x] **Phase 6**: Frontend Foundation & Auth UI
- [x] **Phase 7**: Dashboard: Services, Staff, Settings
- [x] **Phase 8**: Dashboard: Schedule & Appointments
- [x] **Phase 9**: Public Booking Page (Client Flow)
- [x] **Phase 10**: Hardening, E2E & Release Readiness
- [x] **Phase 11**: Audit, Baseline & Niche Narrowing (v2 Foundation, `lib/clock.ts`, BR-12 Any-Master Concurrency, `BusinessType = BARBERSHOP | BEAUTY_SALON`)
- [x] **Phase 12**: Notification Infrastructure (Outbox, Worker, Email, In-App, Audit Log)
- [x] **Phase 13**: Password Recovery (Email + Owner-Generated Reset Links)
- [x] **Phase 14**: Billing Core (Plans, Subscriptions, Trial, Grace, Locked, Manual Payments)
- [x] **Phase 15**: Admin Panel Backend (`PlatformAdmin`, 2FA TOTP, Companies, Payments, Impersonation)
- [x] **Phase 16**: Admin Panel Frontend (`/admin/**`)
- [x] **Phase 17**: Client CRM (Auto-Create, Search, Card, Notes, Blacklist, Anonymize)
- [x] **Phase 18**: Breaks & Time Off (Lunch Breaks, Vacations, Sick Leave, Staff Booking Warnings)
- [x] **Phase 19**: Client Self-Service (`/manage/[token]` View, Cancel, Reschedule)
- [x] **Phase 20**: Staff Notifications & Client Reminders (Telegram Bot, Email, WhatsApp Queue)
- [x] **Phase 21**: Light Prepayment (Manual Transfer Flow, Hold Expiry, Staff Confirm)
- [x] **Phase 22**: Analytics & CSV Export (Owner + Master Scoped)
- [x] **Phase 23**: Onboarding Checklist & Service Presets (`BARBERSHOP`, `BEAUTY_SALON`)
- [x] **Phase 24**: Kyrgyz Language (`RU`/`KY`), Legal Pages (`/privacy`, `/terms`) & Consent
- [x] **Phase 25**: PWA (Manifest, Service Worker, Icons, Install Prompt, 360px Mobile Pass)
- [x] **Phase 26**: Hardening, Full v2 E2E Suite, Security/Performance Audit & Final Release

## Installed Versions (Phase 10 — Release Ready)

- **Node.js**: v24.22.0 (`.nvmrc`: `24`)
- **npm**: 11.19.1
- **TypeScript**: 6.0.3
- **Backend**:
  - `express`: 5.3.0
  - `prisma` / `@prisma/client` / `@prisma/adapter-pg`: 7.10.1 (`pg`: 8.23.1)
  - `argon2`: 0.45.2 (native `argon2id`)
  - `jsonwebtoken`: 9.0.3
  - `cookie-parser`: 1.4.7
  - `express-rate-limit`: 8.7.4
  - `libphonenumber-js`: 1.13.16
  - `luxon`: 3.7.2
  - `zod`: 4.6.7
  - `pino`: 10.4.0 / `pino-http`: 11.0.0 / `pino-pretty`: 13.2.0
  - `helmet`: 8.3.0
  - `cors`: 2.8.6
  - `nodemailer`: 10.5.0 (`@types/nodemailer`: 8.0.2)
  - `otplib`: 13.6.0
  - `tsx`: 4.23.15
  - `vitest`: 5.1.0 / `supertest`: 7.3.2
  - `eslint`: 9.39.5 / `typescript-eslint`: 8.72.2 / `prettier`: 3.10.1
- **Frontend**:
  - `next`: 16.4.6
  - `react` / `react-dom`: 19.3.1
  - `tailwindcss` / `@tailwindcss/turbopack`: 4.3.5
  - `shadcn`: 4.23.0 (`button`, `input`, `label`, `card`, `sonner`, `badge`, `skeleton`)
  - `zustand`: 5.1.0
  - `axios`: 1.21.1
  - `react-hook-form`: 7.92.0 / `@hookform/resolvers`: 7.0.6 / `zod`: 4.6.7
  - `qrcode.react`: 4.2.0
  - `luxon`: 3.7.2 / `libphonenumber-js`: 1.13.16 / `lucide-react`: 1.73.0
  - `@playwright/test`: 1.65.1 (Chromium E2E suite)
- **Infrastructure & CI**:
  - PostgreSQL: `postgres:17-alpine` via `docker-compose.yml` (`zapis` and `zapis_test`)
  - Mailpit: `axllent/mailpit:latest` via `docker-compose.yml` (SMTP `:1025`, Web UI & API `:8025`)
  - Containers: `backend/Dockerfile`, `frontend/Dockerfile` (multi-stage `node:24-alpine`, non-root `node` user)
  - CI: `.github/workflows/ci.yml`

## Ports & URLs

- **Frontend (Next.js)**: `http://localhost:3000`
- **Backend (Express)**: `http://localhost:4000` (API base: `/api/v1`, proxied via Next.js `/api/:path*`)
- **PostgreSQL**: `localhost:5432` (`zapis` dev DB, `zapis_test` test DB)
- **Mailpit UI / HTTP API**: `http://localhost:8025` (SMTP on `localhost:1025`)

## How to Run

```bash
npm install
npm run db:up        # Starts PostgreSQL and Mailpit containers
npm run db:migrate   # Applies Prisma migrations to dev DB
npm run db:seed      # Seeds Demo Barbershop data into dev DB
npm run db:reset     # Resets local dev DB (localhost-only guard) + runs migrations + seeds
npm run dev          # Starts backend (:4000) and frontend (:3000)
npm run worker       # Starts standalone background outbox worker
npm run typecheck    # Runs tsc across backend and frontend
npm run lint         # Runs ESLint (--max-warnings 0) and Prettier check
npm run test         # Runs Vitest suite in backend against zapis_test
npm run build        # Production build for backend and frontend
npm run test:e2e     # Runs Playwright Chromium E2E suite
```

## Demo Seed Credentials (Development Only)

- **Company**: `Barbershop Ala-Too` (slug: `demo-barbershop`, timezone: `Asia/Bishkek`, currency: `KGS`)
- **Owner**: `owner@demo.zapis.kg` / `Demo12345!`
- **Master (with login)**: `master@demo.zapis.kg` / `Demo12345!`
- **Master (without login)**: Нурлан Осмонов (`email: null`)

## Environment Variables

- `backend/.env` (from `backend/.env.example`): `NODE_ENV`, `PORT`, `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `CORS_ORIGINS`, `TRUST_PROXY`, `LOG_LEVEL`, `APP_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `CLIENT_MESSAGE_PROVIDER`, `WORKER_ENABLED`, `WORKER_INTERVAL_MS`, optional rate-limit overrides (`RATE_LIMIT_*`)
- `backend/.env.test`: same keys, targeting `zapis_test` and `LOG_LEVEL=silent`
- `frontend/.env` (from `frontend/.env.example`): `NEXT_PUBLIC_APP_URL`, `BACKEND_INTERNAL_URL`

## Known Issues / Risks

- 2026-11-17: Telegram linking fix: `TELEGRAM_MODE=polling` now starts a long-polling receiver in the API process (independent of `WORKER_ENABLED`) and stops it on shutdown. Profile refreshes connection status while a link is pending. Run only one API instance in polling mode; use webhook mode for multiple instances.
- Verification: 10 tests passed across `telegram-polling.test.ts` and `phase20-notifications.test.ts`. Live read-only Telegram `getMe` and `getWebhookInfo` returned HTTP 200; configured username matches, webhook absent. An actual user `/start` interaction remains to be checked after restarting the backend.
- 2026-11-17, U0: QA-001 resolved in public booking: persist client locale within the booking transaction, explicitly scoped by companyId. Staff CRM upsert contract retained; clients.service.ts formatting repaired. Full ordinary gate passed (155 tests), plus Chromium E2E 1/8/13. Extended redesign/media/security work remains pending; continuation: `docs/QA/STATE.md` and `docs/QA/UPGRADE_PLAN.md`.

- 2026-11-17, post-U1 stabilization: restored QA-001 after its recurrence in the working tree. Fresh full ordinary gate passed (155 tests), Chromium E2E 8/13 passed. Next: U2; see docs/QA/STATE.md.
