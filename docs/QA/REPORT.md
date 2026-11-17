# Промежуточный отчёт — подготовка QA

- Ветка: qa/hardening; исходная правка clients.service.ts сохранена без изменений.
- Выполнены ориентация и создание детерминированного gate.
- Добавлены scripts/gate.mjs, gate/gate:full, .ignore и состояние для возобновления.
- Docker доступен вне песочницы; Node >=22, npm, rg, jq и Chromium доступны.
- node --check, Prettier check новых файлов и git diff --check: exit 0.
- npm run gate: exit 1; typecheck: exit 2, TS2353 на public.service.ts:496.
- QA-001 / P1: несовместимость аргумента locale с контрактом клиентского сервиса.
- Gate подтвердил обнаружение ошибки; успешный полный проход не получен.
- Исправления продукта в этой фазе не выполнялись.
- UNVERIFIED: backend tests, build, full gate, E2E, стресс, security, performance, backup/restore.
- Реальные Telegram, SMS/WhatsApp и production SMTP: UNVERIFIED.
- Процессы приложения и контейнеры не запускались.
- Продолжение: docs/QA/STATE.md; полный аудит и цикл исправлений ещё впереди.
- Человеку: реальное SMTP-письмо; мобильный RU/KY; цены и реквизиты /admin;
  юридическая проверка; кыргызская вычитка; восстановление backup на другой машине.
