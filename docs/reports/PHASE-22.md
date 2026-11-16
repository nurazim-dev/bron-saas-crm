# Отчёт по фазе 22: Аналитика и CSV-экспорт

## Что сделано
1. **Backend (`analytics.schemas.ts`, `analytics.service.ts`, `analytics.routes.ts`)**:
   - Эндпоинты (с ограничением диапазона до 366 дней и SQL-группировкой через `AT TIME ZONE`):
     - `GET /api/v1/analytics/summary` (OWNER, `featureAnalytics`) — выручка (`COMPLETED`), средний чек, полученные предоплаты, статусы, новые/повторные клиенты, источники, дельты к предыдущему равному периоду;
     - `GET /api/v1/analytics/timeseries?granularity=day|week|month` (OWNER, `featureAnalytics`);
     - `GET /api/v1/analytics/services` (OWNER, `featureAnalytics`) — топ услуг;
     - `GET /api/v1/analytics/masters` (OWNER, `featureAnalytics`) — загрузка мастеров с вычетом перерывов и `TimeOff`;
     - `GET /api/v1/analytics/heatmap` (OWNER, `featureAnalytics`) — тепловая карта день недели × час;
     - `GET /api/v1/analytics/me/summary` (MASTER/OWNER, без гейта тарифа, жёстко ограничен своим `userId`);
     - `GET /api/v1/export/appointments.csv` (OWNER, доступен даже при `LOCKED`, UTF-8 BOM, экранирование CSV-инъекций `^[=+\-@\t\r]`).
2. **Frontend (`/dashboard/analytics`, `analytics.api.ts`, `DashboardShell`)**:
   - Добавлен пункт «Аналитика» в меню владельца; установлена библиотека `recharts`.
   - Пресеты периодов (сегодня, 7 дней, 30 дней, этот месяц, прошлый месяц, свой период), фильтр по мастеру, KPI-карточки с дельтами, график выручки, таблицы услуг и загрузки мастеров, тепловая карта, кнопка CSV-экспорта и экран апселла при `FEATURE_NOT_IN_PLAN`.

## Проверки
- `npm run typecheck`, `npm run lint --max-warnings 0`, `npm run build`, `npm run guard`: пройдены (`EXIT=0`).
- Backend тесты: `25` файлов, `135/135` тестов пройдены (включая `phase22-analytics.test.ts` с проверкой UTC-границ, DST, загрузки с перерывами/отпусками, CSV-экранирования и `EXPLAIN` на ~5 000 записях с использованием индекса).
- `db:reset` + `prisma migrate status` (12 миграций, актуально) + `Appointment_no_overlapping_active_slots` подтверждены.
- Playwright E2E: `E2E 11` пройден 3/3 подряд, полный набор `11/11` пройден (`33.3s`).

Автопилот: переход к фазе 23.
