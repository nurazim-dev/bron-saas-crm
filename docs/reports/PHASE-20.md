# Отчёт по фазе 20: Уведомления персонала и напоминания клиентам

## Что сделано
1. **Схема БД и миграция**: `20261116070000_staff_notifications_and_reminders` — enum `ReminderMode`, поля `Company` (`defaultLocale`, `reminderMode`, `remind24h`, `remind2h`), `User` (`notifyEmail`, `notifyTelegram`, `telegramChatId`, `telegramLinkCodeHash`, `telegramLinkCodeExpiresAt`), `Appointment` (`clientLocale`, `manualReminderSentAt`).
2. **Уведомления персонала (`staff-notify.service.ts`)**: маршрутизация событий (`NEW_ONLINE_BOOKING`, `CLIENT_CANCELLED`, `CLIENT_RESCHEDULED`, `STAFF_BOOKING_FOR_MASTER`) в in-app, Email и Telegram с дедупликацией при совпадении владельца и мастера и учётом персональных флагов `notifyEmail`/`notifyTelegram`.
3. **Привязка Telegram (`telegram-link.service.ts`, `/api/v1/me/*`, `/api/v1/telegram/webhook`)**: одноразовые link-коды (TTL 15 мин, SHA-256), проверка `x-telegram-bot-api-secret-token` (`timingSafeEqual`), защита от дублей `telegramChatId`, команды `/start <code>` и `/stop`.
4. **Напоминания клиентам (`reminders.service.ts`)**: матрица планирования (`>26ч` -> 24ч+2ч, `4–26ч` -> 2ч, `<4ч` -> без напоминаний), тихие часы 22:00–08:00 (сдвиг на 08:00 или пропуск при `<30` мин до визита), пересборка при переносе/отмене, send-time recheck (`APPOINTMENT_NOT_SCHEDULED`, `COMPANY_LOCKED`, `maxRemindersPerMonth` с разовым уведомлением владельца `PLAN_REMINDER_CAP_REACHED`), `MANUAL`-очередь WhatsApp (`GET /reminders/queue`, `POST /appointments/:id/reminder-sent`).
5. **Frontend**: колокольчик уведомлений в `DashboardShell` (поллинг 30с, бейдж непрочитанных, отметка прочтения), настройки каналов и Telegram в `/dashboard/profile`, настройки напоминаний и языка по умолчанию в `/dashboard/settings`, вкладка «Напоминания» в `/dashboard/appointments`.

## Проверки
- `npm run typecheck`, `npm run lint --max-warnings 0`, `npm run build`, `npm run guard`: пройдены (`EXIT=0`).
- Backend тесты: `23` файла, `127/127` тестов пройдены (включая `phase20-notifications.test.ts`).
- `db:reset` + `prisma migrate status` (11 миграций, актуально) + `Appointment_no_overlapping_active_slots` подтверждены.
- Playwright E2E: `E2E 9` пройден 3/3 подряд, полный набор `9/9` пройден.

## UNVERIFIED
- Живая отправка и webhook реального Telegram Bot API (протестировано через фейк-провайдер; пользователь заполнит `TELEGRAM_BOT_TOKEN` и `TELEGRAM_BOT_USERNAME` в `backend/.env` в конце).
- Реальный внешний SMS/WhatsApp-шлюз (`CLIENT_MESSAGE_PROVIDER=log`, в production режим `AUTO` скрыт).

Автопилот: переход к фазе 21.
