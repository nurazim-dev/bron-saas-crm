# BRON Phase 4 (Manual Payments) — журнал оплат/возвратов, приватные чеки и разделение выручки

## Реализовано

- Схема Prisma и аддитивная миграция `20261119180000_manual_payments_business_and_proofs`:
  - добавлены `BusinessPaymentKind` (`PAYMENT`, `PREPAYMENT`, `REFUND`), `BusinessPaymentStatus` (`PENDING`, `CONFIRMED`, `REJECTED`, `VOIDED`), `PaymentProofScope` (`SUBSCRIPTION_PAYMENT`, `BUSINESS_PAYMENT`), таблицы `BusinessPayment` и `PaymentProof`, а также составной ключ `SubscriptionPayment_id_companyId_key`.
- Backend (`payment-provider.ts`, `payment-proof.service.ts`, `payments.service.ts`, `billing.service.ts`, `admin.service.ts`):
  - `ManualPaymentProvider` реализует абстракцию провайдера платежей без внешних API;
  - `validateAndProcessProof` проверяет размер (1 Б – 5 МБ), декодирует JPEG/PNG/WebP в WebP через `sharp`, валидирует PDF и отклоняет `/JavaScript`, `/JS`, `/Launch`, `/RichMedia`; лимиты до 5 чеков на операцию и до 50 МБ на компанию; выдача только по приватным URL (`Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`);
  - подтверждение/отклонение `BusinessPayment` выполняется под `FOR UPDATE` с `AuditLog`, `OutboxMessage`, синхронизацией предоплаты записи и защитой от возврата сверх подтверждённых поступлений;
  - загрузка чека к заявке подписки оставлена доступной в состоянии `LOCKED` и никогда не подтверждает оплату автоматически; `PlatformAdmin` получает доступ только к `SUBSCRIPTION_PAYMENT`-чекам и не имеет доступа к клиентским `BusinessPayment`.
- Frontend:
  - новый раздел `Платежи` (`/dashboard/payments`, только `OWNER`) с фильтрами по периоду/статусу, карточками `Подтверждённые поступления (нетто)`, `Подтверждённые возвраты`, `Ожидают проверки` и `Оценка по завершённым визитам`, добавлением операций, подтверждением/отклонением, загрузкой и просмотром приватных чеков;
  - прикрепление и просмотр чеков в `/dashboard/billing` (для заявок `PENDING`) и просмотр чеков в `/admin/payments`;
  - добавлена карточка `Подтверждённые поступления` на странице `/dashboard/analytics`.

## Проверено

- `npm run format && npm run gate`: код выхода `0` (`typecheck` 3.3с, `lint` 9.3с, `test` 37.0с, `build` 4.9с, `guard` 0.1с).
- Полный backend test suite (`cd backend && npm test`): код выхода `0`, `44` файла, `199` тестов прошли (включая `tests/integration/manual-payments-phase4.test.ts`).
- Локальная dev-БД `zapis`: перед миграцией сохранён backup `.tmp/bron-phase4-payments/before.dump` (`223` TOC-записи через `pg_restore --list`). Миграция `20261119180000_manual_payments_business_and_proofs` применена через `prisma migrate deploy` без сброса; `prisma migrate status` подтвердил актуальность `24` миграций; сверка `rows.before` и `rows.after` совпала 1:1 (`Company=7`, `Identity=8`, `User=10`, `Service=21`, `Client=14`, `Appointment=17`, `Subscription=7`, `SubscriptionPayment=2`, `AuditLog=41`).
- Целевой прогон Playwright Chromium против `zapis_test` (`e2e/payments.spec.ts`, `e2e/crm.spec.ts`, `e2e/core-booking.spec.ts`, `e2e/multi-company.spec.ts`, `e2e/sessions.spec.ts`): код выхода `0`, `8` сценариев прошли за `9.4с`, ошибок консоли/страниц нет, проверена вёрстка `360px` и `1440px`, скриншоты сохранены в `artifacts/bron-payments/`.
- Порты `3000` и `4000` свободны (`lsof` пуст).
