# BRON Phase 5 (SaaS Monetization) — матрица тарифов FREE/BUSINESS/PRO, лимиты и управление планами

## Реализовано

- Схема Prisma и аддитивная миграция `20261119190000_saas_plan_matrix_and_limits`:
  - `Plan` расширен полями `description`, `maxServices`, `maxAppointmentsPerMonth`,
    `featureCrmAdvanced`, `featureManualPayments`, `featureMultiCompany`,
    `featureCustomBranding`, `isLegacy` и CHECK-ограничениями `Plan_maxServices_positive` /
    `Plan_maxAppointmentsPerMonth_positive`;
  - добавлен бесплатный публичный тариф `FREE` (`0.00 KGS`, `maxStaff=1`, `maxServices=10`,
    `maxAppointmentsPerMonth=50`, `maxRemindersPerMonth=0`);
  - архивный тариф `START` сохранён без потери прав у текущих компаний (`isLegacy=true`,
    `isPublic=false`, `isActive=true`, `featureCrmAdvanced=true`, `featureManualPayments=true`),
    а `BUSINESS` и `PRO` дополнены описанием и матрицей флагов.
- Backend (`billing.service.ts`, `billing.routes.ts`, `middleware/billing.ts`, `admin.service.ts`,
  `services.service.ts`, `appointments.service.ts`, `public.service.ts`, `clients.routes.ts`,
  `payments.routes.ts`, `auth.service.ts`, `platform-settings.service.ts`):
  - `GET /api/v1/billing` возвращает текущее потребление (`activeStaffCount`, `activeServicesCount`,
    `monthlyAppointmentsCount`, `monthlyRemindersCount`) и лимиты;
  - `POST /api/v1/billing/switch-free` (доступно также из `LOCKED`) переводит компанию на `FREE`
    без удаления данных, запрещая переключение только при наличии заявки `PENDING` (`409`);
  - серверная проверка квот и матрицы (`402 PLAN_LIMIT_REACHED` / `402 FEATURE_NOT_IN_PLAN`) на
    создании/активации услуг, создании записей (staff + public), тегах/merge/import CRM,
    создании/подтверждении/отклонении `BusinessPayment` и создании дополнительной компании;
    исторические данные и чтение сохраняются;
  - `POST /billing/payments` запрещает заявку на `FREE` (`422`) и чужие архивные планы (`404`);
    `pendingClaim` остаётся отдельной от действующей подписки до подтверждения админом;
  - `POST/PATCH /api/v1/admin/plans` редактируют все лимиты и фичи тарифа, запрещая выключать `trialPlanCode`.
- Frontend:
  - `/dashboard/billing`: счётчики всех 4 ресурсов, полная матрица возможностей, кнопка
    «Перейти на Бесплатный» для `FREE`, выбор только платных тарифов в модалке заявки, пометка «Архивный»;
  - `/admin/plans` и лендинг (`/`) показывают полную матрицу лимитов, возможностей и `Бесплатно` для `FREE`.

## Проверено

- `npm run format && npm run gate`: код выхода `0` (`typecheck` 2.8с, `lint` 9.2с, `test` 37.2с,
  `build` 6.2с, `guard` 0.1с).
- Полный backend test suite (`cd backend && npm test`): код выхода `0`, `45` файлов, `202` теста
  прошли (включая 3 комплексных сценария `saas-monetization-phase5.test.ts`).
- Локальная dev-БД `zapis`: перед миграцией сохранён backup `.tmp/bron-phase5-saas/before.dump`
  (`246` TOC-записей через `pg_restore --list`). Миграция `20261119190000_saas_plan_matrix_and_limits`
  применена через `prisma migrate deploy` без сброса; `prisma migrate status` подтвердил актуальность
  `25` миграций; `rows.before` и `rows.after` совпали 1:1 (`Company=7`, `Identity=8`, `User=10`,
  `Service=21`, `Client=14`, `Appointment=17`, `Subscription=7`, `SubscriptionPayment=2`, `AuditLog=41`);
  действующие подписки не потеряли доступ (`BUSINESS=5`, `PRO=2`, `START=0`, `FREE=0`).
- Целевой прогон Playwright Chromium против `zapis_test` (`e2e/saas-billing.spec.ts`,
  `e2e/payments.spec.ts`, `e2e/crm.spec.ts`, `e2e/core-booking.spec.ts`, `e2e/multi-company.spec.ts`,
  `e2e/sessions.spec.ts`): код выхода `0`, `9` сценариев прошли за `10.1с`, ошибок консоли/страниц нет,
  вёрстка проверена на `1440px` и `360px`, скриншоты сохранены в `artifacts/bron-saas/`.
- Порты `3000` и `4000` свободны (`lsof` пуст).
