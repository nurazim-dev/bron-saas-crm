# Отчёт по тестированию безопасности и качества Zapis.kg (`docs/SEC/REPORT.md`)

- **Ветка**: `sec/hardening`
- **Стандарт классификации**: OWASP Top 10:2025 + OWASP ASVS v4.0.3 (Level 2)
- **Команда запуска тестов безопасности**: `npm run test:security` + `npx --workspace=frontend playwright test e2e/security.spec.ts`

## 1. Матрица покрытия доменов (A–J)

| Домен | Статус | Что протестировано и подтверждено |
|-------|--------|-----------------------------------|
| **A. Access Control & Tenancy** | `PASS` | Матрица ролей и тенантов (401/403/404 BR-5), soft-deleted/suspended/LOCKED/impersonation read-only, защита от mass assignment и приватность публичных эндпоинтов |
| **B. Auth, Sessions & Tokens** | `PASS` | JWT (`alg:none`, подпись, `aud`, TTL, `tokenVersion`), ротация refresh-кук, брутфорс и блокировка Admin MFA (`SEC-004`), энтропия >=128 бит и SHA-256 хэши в БД, TOTP replay, CSRF (`Origin`/`Sec-Fetch-Site`/`Referer`) |
| **C. Injection & Output Encoding** | `PASS` | SQLi-пейлоады в строках и параметрах фильтрации/сортировки, экранирование XSS в DOM, HTML-письмах, Telegram HTML, CSV (`=,+,-,@`) и `wa.me`, очистка null-байтов `\u0000` (`SEC-008`), ReDoS, prototype pollution |
| **D. Business-Logic Abuse** | `PASS` | 20-поточные гонки: слот, any-master, manage reschedule/cancel (`SEC-003`), предоплата vs expiry, лимиты `maxStaff`/`maxServices` (`SEC-002`), двойное подтверждение оплаты, анонимизация (`SEC-005`), outbox, регистрация, Telegram link-code, блокировка `LOCKED`/`suspended` в боте (`SEC-001`) |
| **E. Error Handling & Headers** | `PASS` | Единый конверт ошибок без стектрейсов и SQL, изоляция poison-сообщений outbox, заголовки CSP/HSTS/`nosniff`/`Permissions-Policy`/`Cache-Control: no-store`/`Referrer-Policy: no-referrer` и `noindex` (`SEC-009`) |
| **F. Crypto & Secrets** | `PASS` | `gitleaks` (история и дерево), `argon2id`, AES-256-GCM с обязательным `authTagLength: 16` (`SEC-007`), отклонение слабых/шаблонных секретов и `ADMIN_REQUIRE_2FA=true` в `production` (`SEC-007`) |
| **G. Frontend Security** | `PASS` | Отсутствие `dangerouslySetInnerHTML`, хранение accessToken строго в памяти Zustand, очистка токенов из URL (`/reset-password`, `/impersonate`), `frame-ancestors 'none'`, `/sw.js` не кэширует `/api/*` |
| **H. Data Protection & PII** | `PASS` | Полная анонимизация клиента в `Client` (вкл. `telegramChatId`), `Appointment`, `OutboxMessage` (`recipient`, `payload`) и `InAppNotification` (`SEC-005`); маскирование телефонов в `/api/v1/admin/outbox`; `grep` INFO-логов после E2E чист |
| **I. Availability (Local)** | `PASS` | 200 параллельных бронирований на 20 слотов (ровно 20 успешных, 0 дедлоков, 0 ответов 5xx), лимиты пагинации (`<=100`) и диапазона дат аналитики/экспорта (`<=366` дней) |
| **J. Functional QA & Backup** | `PASS` | `npm run gate:full` (`51` файл / `224` backend-теста), `test:security` (`17/17`), 3 прогона Playwright E2E подряд (`28/28`), `pg_dump -Fc` + `pg_restore` во временную БД `zapis_sec_restore_tmp` |

## 2. Сводка уязвимостей (До и После)

| Уровень | Найдено (До) | Исправлено | Открыто (После) | Детали |
|---------|--------------|------------|-----------------|--------|
| **Critical** | `0` | `0` | `0` | — |
| **High** | `6` | `6` | `0` | `SEC-001` (`4d27313`), `SEC-002` (`4c3fac2`), `SEC-003` (`3d2fc65`), `SEC-004` (`cad725d`), `SEC-005` (`d08d2d1`), `SEC-006` (`75cd7f9`) |
| **Medium** | `3` | `3` | `0` | `SEC-007` (`cb16bca`), `SEC-008` (`258e84c`), `SEC-009` (`b58ef6c`) |
| **Low** | `1` | `0` (в `PROPOSALS.md`) | `1` | `SEC-010`: пиннинг GitHub Actions по SHA и `permissions: contents: read` в `.github/workflows/ci.yml` |
| **Info** | `1` | `0` (в `PROPOSALS.md`) | `1` | `SEC-011`: `ffprobe-static@3.1.0` (2022) и `HEALTHCHECK` в `Dockerfile` |

## 3. Остаточные риски и список `UNVERIFIED`

- **Остаточные риски**:
  - CSP фронтенда использует `'unsafe-inline'` для скриптов гидратации Next.js App Router и стилей (`'unsafe-eval'` отключён в production).
  - Бэкапы PostgreSQL (`pg_dump`) содержат PII неанонимизированных клиентов и требуют шифрования на уровне хранилища (S3 SSE-KMS / `age` / `gpg`).
  - Предложения из `docs/SEC/PROPOSALS.md` (`SEC-010`, `SEC-011`, `poweredByHeader: false` в `frontend/next.config.ts`) требуют применения владельцем репозитория.
- **Список `UNVERIFIED` (внешние боевые сервисы и инфраструктура)**:
  - Реальный внешний SMTP-сервер (SPF/DKIM/DMARC, TLS-доставка писем).
  - Реальный Telegram Bot API в боевом окружении (webhook TLS, доставка живым чатам).
  - Боевой платёжный эквайринг и SMS/WhatsApp-шлюз (в коде активен режим `MANUAL`/`LOG`).
  - Боевой reverse-proxy (Nginx/Caddy), TLS-сертификаты, DNS (`customDomain`) и реальная фильтрация `X-Forwarded-For` на периметре.
