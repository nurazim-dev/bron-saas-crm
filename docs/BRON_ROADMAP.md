# BRON: развитие существующего Zapis.kg

## Границы и архитектура

Новый запрос от 17.11.2026 выполняется поверх существующего проекта, без сброса
данных и переписывания. Сохраняем Next.js App Router, Express 5, Prisma/PostgreSQL,
модульный монолит routes → middleware → controller → service, транзакционный outbox.
Публичное название пока Zapis.kg: переименование бренда требует согласованного
изменения UI, писем, metadata и документации, а не замены внутренних идентификаторов.
Ниши остаются BARBERSHOP и BEAUTY_SALON. Реальный деплой не разрешён.

## Инвентаризация по коду (не свидетельство полной приёмки)

| Область | Есть | Недостаёт по новому запросу |
| --- | --- | --- |
| Foundation | Регистрация, login/refresh/logout, серверные сессии, email verification, приглашения, Argon2, password reset, OWNER/MANAGER/MASTER, общая Identity для нескольких компаний и переключение, отдельный PlatformAdmin/TOTP, tenant scope | Закрыта (для prod-выпуска нужны полное восстановление архива и внешний SMTP) |
| Booking | Несколько услуг + мастер/ANY, пакеты услуг (`ServicePackage`), персональные ставки мастеров (`MasterService`), статусы `CONFIRMED`/`IN_PROGRESS` + таблица переходов, snapshots, availability, блокировки и EXCLUDE, перерывы/отпуска, публичная запись/manage (RU/KY), день/неделя/месяц, перенос в дневной сетке | Закрыта (принята после E2E и проверки dev-БД) |
| CRM | Клиенты, история, заметки, blacklist, анонимизация, теги, сегменты, объединение дубликатов и CSV-импорт с preview, глобальный поиск, CRM-аналитика (`repeat`/`retention`/топы) и экспорт CSV | Закрыта (принята после E2E и проверки dev-БД) |
| Платежи | Ручные заявки подписки и оплаты/возвраты бизнеса (`BusinessPayment`), приватные чеки (`PaymentProof`), admin/owner review, `ManualPaymentProvider`, сверка в аналитике | Закрыта (принята после E2E и проверки dev-БД) |
| SaaS | Plan/Subscription/SubscriptionPayment, матрица `FREE`/`BUSINESS`/`PRO`, серверные квоты и фичи, переход на `FREE`, архивный `START`, управление планами в admin | Закрыта (принята после E2E и проверки dev-БД) |
| Business | Onboarding, staff media, RU/KY/EN public & dashboard, уведомления/outbox (RU/KY/EN), брендинг (`description`/`brandColor`/`instagramUrl`), `customDomain` (`PRO`), Dark Mode, экспорт платежей CSV, PWA | Закрыта (принята после E2E и проверки dev-БД) |
| Operations | Docker, CI, health, логи, runbook, `205` backend-тестов (`46` файлов), `10` Chromium E2E, `pg_dump -Fc` backup/TOC проверка | Закрыта локально (для внешнего prod-выпуска нужны DNS/SMTP/TLS и внесерверное хранение бэкапов) |

Источники: backend/prisma/schema.prisma, backend/src/modules, frontend/src/app,
frontend/src/components, docs/QA/U5.md. Выручка по завершённым записям не должна
выдаваться за подтверждённые поступления: новую финансовую аналитику строить по
отдельному журналу подтверждённых платежей услуг.

## План и критерии завершения

1. **Foundation**: сначала аудит и укрепление существующей auth; затем additive
   Session + hashed rotating refresh token, revoke/reuse tests и UI устройств;
   email verification/invitation через outbox; Identity/BusinessMember для нескольких
   компаний с backfill текущих User, уникальным membership и явным tenant selection;
   MANAGER с серверной матрицей разрешений. Старые JWT не получают новые права.
   Отдельный PlatformAdmin сохраняется. Перенос identity делается expand/backfill/
   dual-read/contract с backup и проверкой каждой миграции, без удаления User.
2. **Core Booking**: AppointmentService со снимками цены/длительности, атомарная
   проверка всего интервала; новые режимы календаря и статусы с таблицей переходов.
   Приёмка: конкурентная запись, DST/UTC, доступность, возврат назад, mobile.
3. **CRM**: теги, фильтры, merge/import с preview и tenant tests, global search,
   реальные отчёты. Приёмка: отсутствие утечек и сохранение истории.
4. **Manual Payments**: раздельные SubscriptionPayment и BusinessPayment,
   приватный PaymentProof с лимитами/проверкой содержимого, owner/admin review,
   ManualPaymentProvider без внешних API. Подтверждение + audit + outbox в одной
   транзакции; повторный review не меняет подписку второй раз. Чек не подтверждает
   поступление. Admin платформы не подтверждает оплату услуг салона.
5. **SaaS Monetization**: редактируемые тарифы и features в БД, серверные лимиты,
   продление только после ручного подтверждения, сохранение данных при истечении.
   Pending payment хранится отдельно от состояния действующей подписки.
6. **Business Features**: RU/KY/EN, уведомления, публичный профиль, темы, отчёты.
7. **Production Readiness**: полные tests/E2E, accessibility, performance,
   backup/restore, инструкции и CI. Публикация только по отдельному разрешению.

## Foundation: текущий инкремент

Исправляется конкурентная смена пароля: compare-and-swap по companyId, tokenVersion
и passwordHash; изменение пароля и аудит атомарны. Tenant условие переносится
непосредственно в запросы authenticate/refresh. Миграции не нужны.

Обновление: AuthSession и UI устройств реализованы; logout отзывает сессию,
refresh ротируется атомарно и replay отзывает семейство. Подтверждение email и
приглашения реализованы. MANAGER добавлен с доступом к операционным задачам своей
компании. Добавлена общая учётная запись `Identity` и явное переключение компаний
с созданием второй компании из кабинета — требования Foundation завершены.
Core Booking завершена: добавлены пакеты услуг, индивидуальные цены/длительности
мастеров и статусы `CONFIRMED`/`IN_PROGRESS` с обновлением `EXCLUDE`-ограничения.
CRM завершена: добавлены теги, сегменты, объединение дубликатов, CSV-импорт/экспорт,
глобальный поиск и CRM-аналитика.
Manual Payments завершена: добавлены журнал оплат/возвратов (`BusinessPayment`),
приватные чеки (`PaymentProof`) для подписок и услуг и `ManualPaymentProvider`.
SaaS Monetization завершена: добавлена матрица тарифов `FREE`/`BUSINESS`/`PRO`,
серверные лимиты, переход на `FREE` из `LOCKED` и сохранение архивного `START`.
Business Features и Production Readiness завершены: добавлены `RU`/`KY`/`EN`,
брендинг и `customDomain` (`PRO`), тёмная тема, экспорт платежей CSV, полная
проверка `npm run gate` (`205` тестов) и `10` Chromium E2E-сценариев.
Все фазы выполнены без дополнительного подтверждения по DEC-037; опубликование
production не разрешено.
