# Отчёт по фазе 17 — Client CRM

## Что сделано
- **Миграция и БД**: добавлены `Client`, `pg_trgm` GIN-индексы на `name`/`phone`, поля `Appointment.clientId` и `Appointment.consentAcceptedAt` с безопасным бэкфиллом на засеянной БД (`20261116062055_client_crm`). Проверено сохранение ограничения `Appointment_no_overlapping_active_slots` и чистый `prisma migrate status`.
- **Бэкенд (`/api/v1/clients`)**:
  - Транзакционный `upsertClientInTx` (`INSERT ... ON CONFLICT`) во всех путях создания и обновления записей (онлайн не перезаписывает имя клиента, персонал — обновляет).
  - Блокировка клиента (`403 BOOKING_NOT_ALLOWED` с нейтральным сообщением в публичной записи; персонал может записывать вручную) и обязательное `consentAccepted: true` (`400 VALIDATION_ERROR`).
  - `GET /clients` (поиск, сортировка `lastVisit`/`visits`/`noShows`/`name`, фильтр `blocked`, пагинация, один сгруппированный SQL-запрос без N+1), `GET /clients/:id`, `PATCH /clients/:id` (`OWNER`), `POST /clients/:id/anonymize` (`OWNER`, сохраняет выручку/статусы записей, отменяет `PENDING` outbox, освобождает телефон).
  - Ограничения `MASTER`: видит только своих клиентов и статистику только по своим записям, read-only.
- **Фронтенд**: страницы `/dashboard/clients` и `/dashboard/clients/[id]`, ссылка на карточку клиента из модалки записи, typeahead клиентов при создании записи с предупреждением о блокировке, чекбокс согласия на шаге контактов в `/b/[slug]`.

## Проверки (GATE)
- `npm run format && npm run lint` (`--max-warnings 0`): пройден.
- `npm run typecheck`, `npm run build`, `npm run guard`: пройдены.
- `npm run test`: 20 файлов, 117 тестов пройдены (включая `tests/integration/clients.test.ts` — 4 теста).
- `npm run db:reset && npm run test:e2e`: 6 Playwright-сценариев пройдены; `E2E 6` прошёл 3 раза подряд.

Автопилот: переход к фазе 18.
