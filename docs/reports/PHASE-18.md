# Отчёт по фазе 18 — Breaks & Time Off

## Что сделано
- **Миграция и БД**: добавлены `WorkingHours.breakStart`/`breakEnd` (`CHECK` внутри рабочих часов и `breakStart < breakEnd`), enum `TimeOffKind` и таблица `TimeOff` (`CHECK endAt > startAt`, индексы `(userId, startAt, endAt)`). Ограничение `Appointment_no_overlapping_active_slots` сохранено.
- **`lib/datetime.ts`**: добавлена DST-безопасная функция `localAllDayRangeToUtc(startDate, endDate, timeZone)`.
- **Бэкенд**:
  - `PUT /api/v1/staff/:id/working-hours` принимает и валидирует `breakStart`/`breakEnd`.
  - Движок доступности (`availability.service.ts`) и публичное бронирование (`422 SLOT_NOT_AVAILABLE`) вычитают перерывы и `TimeOff` (включая `ANY`-мастера).
  - `/api/v1/time-off` (`GET`, `POST`, `PATCH`, `DELETE`) с блокировкой мастера (`lockMastersForUpdate`), отчётом `meta.conflicts` и изоляцией прав (`OWNER` — любой сотрудник компании, `MASTER` — только свой, иначе `404`).
  - Создание/обновление записи персоналом разрешает оверрайд перерывов/отсутствий/внерабочего времени и возвращает `warnings` (`OUTSIDE_WORKING_HOURS`, `DURING_BREAK`, `DURING_TIME_OFF`).
- **Фронтенд**: выбор перерывов в графике работы (`/dashboard/staff`), управление отпусками/больничными в `/dashboard/staff` и `/dashboard/profile`, штрихованные блоки перерывов и `TimeOff` в сетке расписания (`/dashboard/schedule`), предупреждения о конфликтах в модалках записей.

## Проверки (GATE)
- `npm run format && npm run lint` (`--max-warnings 0`): пройден.
- `npm run typecheck`, `npm run build`, `npm run guard`: пройдены.
- `npm run test`: 21 файл, 120 тестов пройдены (включая `tests/integration/breaks-time-off.test.ts` с DST-тестами, перерывами, отпусками и оверрайдом).
- `npm run db:reset && npm run test:e2e`: 7 Playwright-сценариев пройдены; `E2E 7` прошёл 3 раза подряд.

Автопилот: переход к фазе 19.
