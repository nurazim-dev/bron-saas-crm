# BRON Phase 3 (CRM) — теги, сегменты, объединение дубликатов, CSV-импорт и глобальный поиск

## Реализовано

- Схема Prisma и аддитивная миграция `20261119170000_crm_tags_and_merge_support`:
  - добавлены `ClientTag` (регистронезависимая уникальность `lower("name")` в рамках компании)
    и `ClientTagAssignment` с составными tenant-FK;
  - добавлены `Client.mergedIntoClientId`, `Client.mergedAt` и ограничение
    `Client_merged_not_self_check` для недеструктивного слияния дубликатов.
- Backend (`clients.service.ts`, `clients-tags.service.ts`, `clients-merge.service.ts`,
  `clients-import.service.ts`, `search.service.ts`, `analytics.service.ts`):
  - CRUD тегов, фильтрация по `tagId` и CRM-сегментам (`NEW`, `REPEAT`, `VIP`, `AT_RISK`,
    `LOST`, `NO_SHOW_RISK`, `BLOCKED`), сортировка по `totalSpent`, исключение объединённых
    карточек и обновление `nextAppointmentAt` (`SCHEDULED`/`CONFIRMED`/`IN_PROGRESS`);
  - слияние клиентов `preview -> execute` под блокировкой `FOR UPDATE`: перенос всей
    истории записей, объединение тегов/заметок, сохранение блокировки и освобождение
    телефона дубля;
  - CSV-импорт `preview -> execute` (до 500 строк, стратегии дубликатов и авто-создание
    тегов) со строгой tenant-изоляцией и экспорт `GET /api/v1/export/clients.csv`;
  - глобальный поиск `GET /api/v1/search` с ролевой изоляцией (`OWNER`/`MANAGER`/`MASTER`)
    и `GET /api/v1/analytics/crm` с пометкой `COMPLETED_VISITS_ESTIMATE`.
- Frontend:
  - `GlobalSearch` в шапке кабинета (`⌘K`/кнопка «Поиск»);
  - сегменты, теги, модалки `ClientTagsManager`, `ClientMergeDialog`, `ClientImportDialog`
    и экспорт CSV в `/dashboard/clients` и `/dashboard/clients/[id]`;
  - блок CRM-аналитики и явное разграничение оценки по завершённым визитам в `/dashboard/analytics`.

## Проверено

- `npm run format && npm run gate`: код выхода `0` (`typecheck` 3.4с, `lint` 8.6с, `test` 35.6с,
  `build` 5.8с, `guard` 0.1с).
- Полный backend test suite (`cd backend && npm test`): код выхода `0`, `43` файла, `197`
  тестов прошли (включая 4 новых интеграционных сценария `crm-phase3.test.ts` для тегов,
  сегментов, слияния, импорта, глобального поиска, CRM-аналитики и экранирования CSV).
- Локальная dev-БД `zapis`: перед миграцией сохранён backup `.tmp/bron-phase3-crm/before.dump`
  и проверен `pg_restore --list` (`196` TOC-записей). Миграция применена через
  `prisma migrate deploy` без сброса; `prisma migrate status` подтвердил актуальность
  `23` миграций; сверка `rows.before` и `rows.after` совпала 1:1 (`Company=7`, `Identity=8`,
  `User=10`, `Service=21`, `Client=14`, `Appointment=17`, `AuditLog=41`).
- Целевой прогон Playwright Chromium против `zapis_test` (`e2e/crm.spec.ts`,
  `e2e/core-booking.spec.ts`, `e2e/multi-company.spec.ts`, `e2e/sessions.spec.ts`): код
  выхода `0`, `7` сценариев прошли за `7.9с`, ошибки консоли и страниц отсутствуют;
  проверена вёрстка `360px` и `1440px`, скриншоты сохранены в `artifacts/bron-crm/`.
- Порты `3000` и `4000` свободны.
