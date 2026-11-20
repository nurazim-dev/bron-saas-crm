# BRON Foundation — общая учётная запись и несколько компаний

## Реализовано

- Добавлена модель `Identity` (общие логин, пароль, `credentialVersion`,
  `lastCompanyId`) при сохранении `User` в роли членства компании (`companyId`,
  `role`, `tokenVersion`, профиль сотрудника). Существующие `User.id` и все
  связи с записями, услугами, графиками и аудитом сохранены.
- Аддитивная миграция `20261119150000_identity_memberships` создаёт `Identity`,
  выполняет backfill существующих записей с email, проверяет отсутствие
  расхождений, добавляет уникальные индексы `[identityId, companyId]` и
  `[companyId, email]`, check-ограничение `User_email_identity_check` и
  отложенные триггеры согласованности email.
- В API добавлены `GET /api/v1/auth/companies`, `POST /api/v1/auth/companies`
  (только `OWNER`) и `POST /api/v1/auth/switch-company`. Переключение и создание
  компании отзывают текущую серверную сессию `sid` и выдают новый access JWT и
  refresh cookie `zapis_rt` строго для выбранного членства. Чужой `companyId`
  возвращает `404 NOT_FOUND`.
- Обновлены `register`, `login`, `refresh`, `logout`, `sessions`, `password`,
  `forgot-password`/`reset-password`, `email-verification`, `staff.service`,
  `invitations.service` и `admin.service`. Владелец одной компании не может
  изменять email, пароль или ссылку сброса сотрудника, чья `Identity` связана
  с другой компанией (`409 SHARED_IDENTITY`). `PlatformAdmin` и режим поддержки
  только для чтения изолированы; при impersonation недоступно переключение и
  создание компаний (`403 IMPERSONATION_READ_ONLY`).
- На фронтенде добавлен `CompanySwitcher` в шапку кабинета (выбор компании и
  создание дополнительной компании для `OWNER`), список компаний в
  `useAuthStore`, отображение компании в списке сессий и защита от устаревших
  данных: `resetTenantRequestContext` (`tenantEpoch` + `AbortController`),
  очистка `scopedBilling`, сброс `NotificationBell` и перемонтирование `<main>`
  по ключу `companyId:userId`.

## Проверено

- `npm run gate` (после финальных правок кода): код выхода `0` (`typecheck` 2.6с,
  `lint` 7.9с, `test` 33.9с, `build` 4.4с, `guard` 0.1с).
- Backend suite: `41` файл, `190` тестов прошли (`multi-company-identity.test.ts`:
  7 тестов — создание второй компании, переключение в обе стороны, сохранение
  связей, 404 на чужие объекты, отзыв/replay/legacy JWT, права `MANAGER` и
  `MASTER`, смешанные роли, защита от `SHARED_IDENTITY`, смена/сброс пароля,
  подтверждение email, приглашения, выход, изоляция `PlatformAdmin`/impersonation,
  проверка constraint БД).
- Целевой прогон Chromium против `zapis_test` (`e2e/multi-company.spec.ts`,
  `e2e/sessions.spec.ts`, `e2e/calendar.spec.ts`, `e2e/multi-service.spec.ts`):
  код выхода `0`, `8` сценариев прошли за `7.3с` (включая создание второй
  компании в UI, различимые данные в двух компаниях, проверку отмены
  задержанного ответа при переключении, сохранение выбранной компании после
  `page.reload()` и вёрстку 360px/1440px).
- Локальная dev-БД `zapis`: снят backup `.tmp/bron-multicompany/before.dump` и
  проверен `pg_restore --list` (`184` строки). Миграция применена через
  `prisma migrate deploy` без сброса; `prisma migrate status` подтвердил
  актуальность 20 миграций. Сверка `rows.before` и `rows.after` совпала 1:1
  (`Company=7`, `User=10`, `Appointment=17`, `Service=21`, `WorkingHours=49`,
  `AuditLog=41`); `Identity=8`, расхождений `0`, битых связей `0`.
- Временные серверы остановлены, порты `3000` и `4000` свободны.

## Ограничения проверки

- Проверен целевой набор из 8 E2E-сценариев; полный прогон `zapis.spec.ts` и
  `gate:full` в рамках этой задачи не выполнялись.
- Полное восстановление дампа `before.dump` в отдельную БД и отправка писем
  через внешний SMTP-провайдер не тестировались.
