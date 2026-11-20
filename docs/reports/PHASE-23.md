# Отчёт по фазе 23: Онбординг и пресеты услуг

## Что сделано
1. **Схема БД и миграция**: `20261116090000_onboarding` — добавлены поля `Company` (`onboardingLinkSharedAt`, `onboardingCompletedAt`, `onboardingDismissedAt`).
2. **Backend (`onboarding.presets.ts`, `onboarding.schemas.ts`, `onboarding.service.ts`, `onboarding.routes.ts`)**:
   - Пресеты услуг с ориентировочными ценами для `BARBERSHOP` (7 пресетов) и `BEAUTY_SALON` (8 пресетов).
   - Эндпоинты (OWNER): `GET /api/v1/onboarding` (динамический расчёт 4 шагов по реальным данным), `GET /api/v1/onboarding/presets`, `POST /api/v1/onboarding/apply` (идемпотентное создание услуг, график Пн–Сб 10:00–20:00 по умолчанию, добавление первого мастера с проверкой `maxStaff`), `POST /api/v1/onboarding/dismiss`, `POST /api/v1/onboarding/link-shared`.
3. **Frontend**:
   - Мастер настройки `/dashboard/onboarding` (5 шагов: контакты, выбор пресетов с редактированием цены/длительности, мастер и график, публичная ссылка + QR-код, готово).
   - Перенаправление после `/register` на `/dashboard/onboarding`.
   - Виджет чеклиста на `/dashboard` с прогрессом и кнопкой скрытия.

## Проверки
- `npm run typecheck`, `npm run lint --max-warnings 0`, `npm run build`, `npm run guard`: пройдены (`EXIT=0`).
- Backend тесты: `26` файлов, `137/137` тестов пройдены (включая `phase23-onboarding.test.ts`).
- `db:reset` + `prisma migrate status` (13 миграций, актуально) + `Appointment_no_overlapping_active_slots` подтверждены.
- Playwright E2E: `E2E 12` пройден 3/3 подряд, полный набор `12/12` пройден (`34.9s`).

Автопилот: переход к фазе 24.
