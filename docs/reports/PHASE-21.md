# Отчёт по фазе 21: Лёгкая предоплата (Light Prepayment)

## Что сделано
1. **Схема БД и миграция**: `20261116080000_light_prepayment` — добавлены `SYSTEM` в `CancelActor`, enum'ы `PrepaymentMode` (`FIXED`, `PERCENT`) и `PrepaymentStatus` (`NOT_REQUIRED`, `PENDING`, `RECEIVED`, `REFUNDED`), поля `Company` (`paymentInstructions`, `prepaymentHoldMin`), `Service` (`requiresPrepayment`, `prepaymentMode`, `prepaymentValue`), `Appointment` (`prepaymentStatus`, `prepaymentAmount`, `prepaymentHoldUntil`, `prepaymentReceivedAt`), индексы и SQL CHECK-ограничения (`Company_prepaymentHoldMin_chk`, `Service_prepayment_chk`, `Appointment_prepaymentAmount_chk`).
2. **Backend (BR-18)**:
   - Расчёт предоплаты (`computePrepaymentAmount` с округлением процентов до целого сома и ограничением ценой услуги) и формирование WhatsApp-ссылки для отправки чека (`buildWhatsappProofUrl`).
   - Гейтинг `featurePrepayment` (402 `FEATURE_NOT_IN_PLAN`) и обязательность `paymentInstructions` (409 `PAYMENT_INSTRUCTIONS_REQUIRED`) при настройке услуги.
   - Атомарные переходы `POST /api/v1/appointments/:id/prepayment` (`RECEIVED`, `WAIVE` — владелец или мастер записи; `REFUND` — только владелец) с аудит-логом.
   - Фоновая джоба истечения холда (`prepayment-expiry.job.ts` в `worker/runner.ts`) с атомарным условным обновлением (`WHERE prepaymentStatus = 'PENDING'`), отменой напоминаний и уведомлением персонала (и клиента в режиме `AUTO`).
   - Публичная запись и `/manage/:token` возвращают блок `prepayment` (сумма, реквизиты, дедлайн, кнопка WhatsApp).
3. **Frontend**: настройки реквизитов и времени удержания в `/dashboard/settings`, форма предоплаты с предпросмотром суммы и проверкой тарифа в `/dashboard/services`, фильтр и бейджи предоплаты в `/dashboard/appointments`, блок управления предоплатой в карточке записи, счётчик «Ожидают предоплату» на `/dashboard`, блок предоплаты на `/b/[slug]` и `/manage/[token]`.

## Проверки
- `npm run typecheck`, `npm run lint --max-warnings 0`, `npm run build`, `npm run guard`: пройдены (`EXIT=0`).
- Backend тесты: `24` файла, `131/131` тестов пройдены (включая `phase21-prepayment.test.ts` с проверкой гонки `RECEIVED` vs expiry).
- `db:reset` + `prisma migrate status` (12 миграций, актуально) + `Appointment_no_overlapping_active_slots` подтверждены.
- Playwright E2E: `E2E 10` пройден 3/3 подряд, полный набор `10/10` пройден (`32.5s`).

Автопилот: переход к фазе 22.
