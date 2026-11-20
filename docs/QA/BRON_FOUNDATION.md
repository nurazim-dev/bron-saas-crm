# BRON Foundation — первый инкремент, 17.11.2026

Статус: аудит/план и укрепление существующей авторизации выполнены;
полная Phase 1 нового master prompt остаётся открытой.

## Изменения

- Инвентаризация и архитектура развития: ../BRON_ROADMAP.md.
- Authenticate и refresh явно включают companyId в запрос пользователя.
- Смена пароля: условное обновление по прежнему hash/tokenVersion/companyId.
- Смена пароля и запись audit объединены в транзакцию.
- Проверки: чужой companyId в подписанных JWT, конкурентная смена пароля,
  откат при отказе audit; старые access/refresh после смены отвергаются.

## Выполненные проверки

- npm run gate: exit 0.
- TypeScript, ESLint/Prettier, build обоих workspaces, guard: exit 0.
- Backend: 166 тестов в 35 файлах прошли, включая 3 новых теста.
- git diff --check: exit 0.
- Использована локальная zapis_test, адрес проверен до запуска.
- Миграции тестовой БД: 15 найдены, неприменённых нет.
- E2E/Chromium в этом инкременте не запускались; UI не менялся.
- Логи: artifacts/bron-foundation/gate-summary.json и tests.log.
- Созданные gate процессы завершились; серверы для этой работы не запускались.
- Рабочая БД не сбрасывалась; .env не менялись; деплоя не было.
- Начальный tracked diff сохранён в artifacts/bron-foundation/before.patch;
  существующие tracked/untracked файлы не удалялись и не откатывались.

## Ограничения и продолжение Phase 1

- Нет управления отдельными сессиями; logout очищает cookie, старые refresh JWT
  не погашаются при ротации. Следующая работа: Session, revoke, reuse protection.
- Нет email verification, приглашений, MANAGER и multi-company membership.
- В тестах остаётся pg DeprecationWarning о concurrent client.query.
- Чеки, расширение бронирования/CRM и тарифов относятся к следующим фазам.
- К Phase 2 не переходили. Прежние отчёты U2–U5 не доказывают полноту нового ТЗ.
