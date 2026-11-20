# BRON Core Booking — пакеты услуг, индивидуальные ставки мастеров и статусы визита

## Реализовано

- Схема Prisma и две последовательные миграции (`20261119160000_booking_packages_pricing_status_enum`
  и `20261119160500_booking_status_exclude_update`):
  - добавлены статусы `CONFIRMED` и `IN_PROGRESS` в `AppointmentStatus`;
  - пересоздано ограничение БД `Appointment_no_overlapping_active_slots` (`SCHEDULED`,
    `CONFIRMED`, `IN_PROGRESS`, `COMPLETED`);
  - в `MasterService` добавлены необязательные `customPrice` и `customDurationMin`;
  - добавлены `ServicePackage`, `ServicePackageItem` с составными tenant-FK и
    `Appointment.packageId`/`packageName`.
- Backend (`status-transitions.ts`, `service-selection.ts`, `packages.service.ts`,
  `staff.service.ts`, `appointments.service.ts`, `availability.service.ts`,
  `public.service.ts`, `public-manage.service.ts`, `analytics.service.ts`,
  `reminders.service.ts`, `time-off.service.ts`, `prepayment-expiry.job.ts`):
  - CRUD пакетов (`/api/v1/services/packages`) и пропорциональное распределение выручки
    пакета в `AppointmentService`;
  - персональные цены/длительность мастеров в staff API, публичном профиле и поиске
    слотов (включая `ANY`-мастера);
  - серверная таблица переходов статусов и клиентское управление при `SCHEDULED`/`CONFIRMED`.
- Frontend:
  - `/dashboard/staff`: ввод и редактирование `customPrice` / `customDurationMin` на услугу;
  - `/dashboard/services`: блок `PackagesSection` (создание, редактирование, удаление пакетов);
  - `appointment-dialogs.tsx`, `/dashboard/appointments`, `/dashboard/schedule`,
    `/dashboard`, `/manage/[token]`: выбор пакета при создании записи, пересчёт цены
    по ставке мастера, кнопки переходов `CONFIRMED`/`IN_PROGRESS`, drag-and-drop и счётчики;
  - `/b/[slug]` (`PublicBookingStepper`): витрина пакетов и отдельных услуг (RU/KY),
    отображение персональной цены и длительности мастера на шаге выбора мастера и в сводке.

## Проверено

- `node frontend/scripts/check-i18n-parity.mjs`: код выхода `0` (`91` ключей в `ru` и `ky`).
- `npm run format && npm run gate`: код выхода `0` (`typecheck` 4.2с, `lint` 8.4с, `test` 36.4с,
  `build` 6.5с, `guard` 0.1с).
- Backend test suite (`cd backend && npm test`): код выхода `0`, `42` файла, `193` теста
  прошли (включая 3 новых интеграционных сценария `core-booking-phase2.test.ts` с проверкой
  SQL-пересечений в `EXCLUDE`, изоляции пакетов и пропорциональной аналитики).
- Локальная dev-БД `zapis`: перед миграцией сохранён backup `.tmp/bron-phase2-complete/before.dump`
  и проверен `pg_restore --list` (`182` TOC-записи). Миграции применены через
  `prisma migrate deploy` без сброса; `prisma migrate status` подтвердил актуальность
  `22` миграций. Сверка `rows.before` и `rows.after` совпала 1:1 (`Company=7`, `Identity=8`,
  `User=10`, `Service=21`, `MasterService=31`, `Appointment=17`, `Client=14`, `AuditLog=41`);
  ограничение `Appointment_no_overlapping_active_slots` в БД включает
  `'SCHEDULED'`, `'CONFIRMED'`, `'IN_PROGRESS'`, `'COMPLETED'`.
- Целевой прогон Playwright Chromium против `zapis_test` (`e2e/core-booking.spec.ts`,
  `e2e/calendar.spec.ts`, `e2e/multi-service.spec.ts`, `e2e/multi-company.spec.ts`,
  `e2e/sessions.spec.ts`): код выхода `0`, `9` сценариев прошли за `9.6с`, ошибки консоли
  и страниц отсутствуют; проверена вёрстка `360px` и `1440px`, скриншоты сохранены в
  `artifacts/bron-core-booking/public-package-mobile.png` и
  `artifacts/bron-core-booking/public-package-desktop.png`.
- Временные серверы остановлены, порты `3000` и `4000` свободны.
