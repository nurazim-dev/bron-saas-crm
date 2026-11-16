# Notification & Worker Architecture (`docs/NOTIFICATIONS.md`)

Zapis.kg delivers all external notifications asynchronously via a **transactional PostgreSQL outbox** (`OutboxMessage`) and a dedicated background worker (`backend/src/worker/`). User-facing HTTP requests never wait on or fail because of SMTP or Telegram Bot API calls.

---

## 1. Outbox Lifecycle (`OutboxMessage`)

```
PENDING ──(claim: FOR UPDATE SKIP LOCKED)──▶ PROCESSING
  ▲                                            │
  │ (transient error, attempts < maxAttempts)  ├──▶ SENT (delivered)
  └──── backoff: 1m, 5m, 30m, 2h, 12h ─────────┼──▶ SKIPPED (recheck hook returned skip=true)
                                               └──▶ FAILED (permanent error or attempts == maxAttempts)
```

- **Transactional enqueue**: `enqueue(db, spec)` inserts into `OutboxMessage` using `INSERT ... ON CONFLICT ("dedupeKey") DO NOTHING RETURNING "id"`.
  - If the enclosing `prisma.$transaction` rolls back, the outbox row rolls back with it.
  - Duplicate `dedupeKey` calls inside a transaction are safely ignored without aborting the PostgreSQL transaction.
- **Concurrent dispatch**: `claimDueMessages` claims due `PENDING` rows (`scheduledFor <= now()`) with `FOR UPDATE SKIP LOCKED` in a single atomic `UPDATE ... RETURNING`. Multiple worker instances never send the same message twice.
- **Recheck hooks**: `registerOutboxRecheckHook(kind, hook)` lets domain modules cancel stale scheduled notifications (e.g., reminders for cancelled appointments) right before provider delivery, transitioning them to `SKIPPED`.

---

## 2. Channels & Providers

Provider instances are resolved from `backend/src/lib/registry.ts` (`getProviderRegistry()` / `setProviderRegistry()` for tests).

| Channel | Provider Interface | Production Implementation | Notes |
| --- | --- | --- | --- |
| `EMAIL` | `EmailProvider` | `NodemailerEmailProvider` (`nodemailer`) | Connects to `SMTP_HOST:SMTP_PORT`; local dev uses Mailpit (`localhost:1025`, UI `:8025`). |
| `TELEGRAM` | `TelegramProvider` | `HttpTelegramProvider` (`fetch` Bot API) | Sends with `parse_mode: 'HTML'`; user text escaped via `escapeTelegramHtml`. Permanent 4xx (400/403) fails immediately; 429/5xx retries. |
| `SMS` / `WHATSAPP` | `ClientMessageProvider` | `LogClientMessageProvider` (`isConfigured = false`) | No SMS/WhatsApp gateway in v2; logs masked metadata and marks `SENT` (or handled via manual WhatsApp queue in Phase 20). |

In-app notifications are stored directly in `InAppNotification` via `createInAppNotification(db, ...)` inside the business transaction and served at `/api/v1/notifications`.

---

## 3. Template Registry (`backend/src/modules/notifications/templates/index.ts`)

Templates are registered per `kind` and rendered per `Locale` (`RU` | `KY`) into `{ subject, text, html, telegramHtml }`.

| `kind` | Description | Locales |
| --- | --- | --- |
| `SYSTEM_TEST` | Infrastructure smoke test / admin test email | `RU`, `KY` |
| `GENERIC` | Fallback structured `{ subject, text, html? }` message | `RU`, `KY` |
| `PASSWORD_RESET` | Single-use password reset link (`APP_URL/reset-password?token=...`, 60 min TTL) | `RU`, `KY` |

Additional templates (`PASSWORD_RESET`, `BOOKING_CREATED`, `BOOKING_REMINDER`, `SUBSCRIPTION_EXPIRING`, etc.) are registered by their respective feature phases.

---

## 4. Worker Modes & Health

- **Standalone worker** (recommended for production): `npm run worker` (`backend/src/worker/index.ts`).
- **Embedded worker** (optional for single-process dev): set `WORKER_ENABLED=true` in `backend/.env` to run `startWorkerLoop()` inside `server.ts`.
- **Advisory lock**: `withAdvisoryLock(lockKey, fn)` in `backend/src/lib/prisma.ts` uses `pg_try_advisory_lock(hashtext($1))` on a dedicated pool connection so periodic jobs do not overlap across replicas.
- **Heartbeat**: Every tick upserts `WorkerHeartbeat` (`name = 'main'`). `GET /api/v1/health` reports `worker: { status: 'up' | 'stale' | 'disabled', lastBeatAt }` and returns `status: 'degraded'` (HTTP `200`) if the heartbeat is older than 2 minutes (`120_000 ms`).

---

## 5. Environment Variables

- `APP_URL` — Public web base URL used in notification links (e.g. `http://localhost:3000`)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`
- `CLIENT_MESSAGE_PROVIDER` (`log` default)
- `WORKER_ENABLED` (`false` default in API; `true` only for embedded mode)
- `WORKER_INTERVAL_MS` (`5000` default, minimum `1000`)

---

## 6. How to Add a Template or Provider

1. **New template**: Call `registerNotificationTemplate('MY_KIND', (locale, payload) => ({ subject, text, html, telegramHtml }))` in `templates/` and escape all user-controlled strings with `escapeHtml` / `escapeTelegramHtml`.
2. **New provider**: Implement the corresponding interface in `backend/src/modules/notifications/providers/` and wire it into `createDefaultRegistry()` in `backend/src/lib/registry.ts` based on `env`.
