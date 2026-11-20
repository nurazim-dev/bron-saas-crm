# Последовательное развитие BRON — Foundation

Разрешение пользователя: выполнять все фазы подряд (DEC-037).
Весь master prompt пока НЕ завершён.

## Выполнено

- Нативный повторный drag проверен обычными движениями мыши: для dragover требуется
  промежуточное движение. Убрана подмена событий dispatchEvent из конфликта теста.
- AuthSession, sid, SHA-256 refresh hashes, атомарная ротация под row lock.
- Replay отзывает сессию; logout и отзыв устройства блокируют и access, и refresh.
- Смена/сброс пароля отзывает сессии. Impersonation/admin auth не смешаны со staff.
- Список устройств и подтверждение отзыва в профиле. Только свои userId/companyId.
- Отзыв сессии и replay записываются в audit без токенов.
- Подтверждение email: запрос из профиля, outbox, ссылка 60 минут, одноразовый hash.
- Смена email сотрудника сбрасывает подтверждение и старую ссылку.
- Приглашение мастера: owner-only, лимиты, passwordHash=null до установки пароля,
  статус «Приглашён», повторная ссылка через редактирование сотрудника; письмо/audit/приглашение в транзакции, ссылка для ручной передачи, самостоятельный пароль.

## Проверки

- Полный обычный gate: exit 0, typecheck/lint/backend tests/build/guard.
- Backend: 181 тест / 39 файлов (3 sessions, 3 verification, 2 invitations добавлены).
- Chromium: 8 сценариев passed: календарь/DST, booking нескольких услуг, устройства,
  invalid email link, успешное email confirmation, приглашение → пароль → login,
  прежний E2E 1 регистрации/услуги/мастера/public booking/manage.
- Sessions UI: 360/1440 без overflow; скриншоты в artifacts/bron-autopilot.
- Регрессионная смена пароля выявила ошибочную последовательность handlers в PATCH;
  исправлена и повторно проверена существующим набором tests.
- Новый invitation-test первоначально оставлял изменённый maxStaff общего тестового
  тарифа. Добавлено восстановление в afterEach; загрязнение zapis_test исправлено.
- Invitation E2E ожидал видимый footer вместо завершения reset; исправлено ожидание
  успешного сообщения и последующий login вернул HTTP 200.
- Артефакты: artifacts/bron-autopilot/{gate-summary.json,e2e.log,migration.json}.
- Dev backup создан с mode 0600 в .tmp/bron-autopilot; pg_restore --list exit 0.
- Dev migration deploy: AuthSession + email fields. До/после 7 компаний, 10 пользователей,
  17 записей, совпадение counts. Данные не сбрасывались; production не менялся.

## Ограничения

- Foundation ещё требует MANAGER и multi-company identity/membership.
- Core Booking: новые статусы, пакеты и цены мастеров впереди.
- CRM expansion, private receipts/payment ledger, новые тарифы/features,
  RU/KY/EN кабинета и итоговая production-приёмка ещё не завершены.
- Старые refresh без sid требуют повторного login; старые access без sid
  принимаются до существующего срока действия (если не отозваны tokenVersion).
- Refresh replay protection строго отзывает семейство; параллельное обновление
  одного cookie в разных вкладках требует дальнейшей проверки пользовательского опыта.
- Email и приглашения проверены через outbox; реальная внешняя доставка не проверялась.
- Полного восстановления нового backup не было, проверен каталог.
- Старые pg concurrent-query и NO_COLOR warnings остаются; полный E2E не запускался.
