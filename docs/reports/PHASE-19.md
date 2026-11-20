# Отчёт по фазе 19 — Client Self-Service

## Что сделано
- **Миграция и БД**: добавлены `Company.clientCancelMinHours` (`CHECK 0..168`), `Company.allowClientReschedule`, enum `CancelActor`, `Appointment.manageToken` (бэкфилл + `UNIQUE NOT NULL`), `cancelledAt`, `cancelledBy`, `cancelReason`, `rescheduledCount`. Ограничение `Appointment_no_overlapping_active_slots` сохранено.
- **Бэкенд**:
  - `POST /public/companies/:slug/appointments` генерирует криптостойкий `manageToken` и возвращает `manageUrl`.
  - Публичные эндпоинты `/public/manage/:token` (`GET`), `/availability` (`GET`), `/cancel` (`POST`), `/reschedule` (`POST`) с rate-limit (`60/ч` чтение, `10/ч` запись), `404` для неизвестного токена, проверкой окна отмены/переноса и лимита переносов (`422 CHANGE_NOT_ALLOWED`), исключением собственной записи при переносе и работой отмены даже при `LOCKED`-подписке.
  - Уведомления персонала (`InAppNotification` + `EMAIL` outbox) и аудит при отмене/переносе клиентом; фиксация `cancelledBy = STAFF` при отмене персоналом.
- **Фронтенд**: страница `/manage/[token]` (карточка записи, отмена с подтверждением, перенос со списком дат и слотов, понятный статус при закрытом окне с контактами компании), ссылка управления и кнопка копирования на экране подтверждения записи, поля политики отмены/переноса в `/dashboard/settings`, отображение `cancelledBy`/`rescheduledCount` в модалке записи.

## Проверки (GATE)
- `npm run format && npm run lint` (`--max-warnings 0`): пройден.
- `npm run typecheck`, `npm run build`, `npm run guard`: пройдены.
- `npm run test`: 22 файла, 123 теста пройдены (включая `tests/integration/client-self-service.test.ts` с `FakeClock`, гонкой переноса и `LOCKED`-отменой).
- `npm run db:reset && npm run test:e2e`: 8 Playwright-сценариев пройдены; `E2E 8` прошёл 3 раза подряд.

Автопилот: переход к фазе 20.
