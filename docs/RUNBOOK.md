# Zapis.kg — Operations Runbook

## 1. Production Deployment & Health Checks

- **Containers**: `postgres` (`postgres:17-alpine`), `api` (`node dist/server.js`, `WORKER_ENABLED=false`), `worker` (`node dist/worker/index.js`, `WORKER_ENABLED=true`), `frontend` (`npm run start`).
- **Templates**: [`docker-compose.prod.example.yml`](../docker-compose.prod.example.yml), [`backend/.env.production.example`](../backend/.env.production.example), [`frontend/.env.production.example`](../frontend/.env.production.example).
- **Migrations**: Run `npx prisma migrate deploy --config backend/prisma.config.ts` before starting new `api`/`worker` containers.
- **Health endpoints**:
  - `GET /api/v1/health` — liveness (`200 { data: { status: "ok" } }`).
  - `GET /api/v1/health/ready` — DB + worker readiness (`200` / `503`).

## 2. Suspend / Unsuspend Tenant

1. Log in to `/admin` (Platform Admin Console, TOTP 2FA required in production).
2. Open **Компании** (`/admin/companies`), select the target salon/barbershop.
3. Click **Заблокировать** (sets `Company.suspendedAt`, returns `403 COMPANY_SUSPENDED` for staff and hides public booking) or **Разблокировать**.
4. All actions are recorded in `AuditLog`.

## 3. Confirm Manual Subscription Payments & Manage Trials

1. Open `/admin/payments` or `/admin/companies/[id]`.
2. Verify bank transfer / QR receipt against the `Invoice` (`PENDING`).
3. Click **Подтвердить оплату** (sets invoice `PAID`, extends `Subscription.periodEndsAt` and unlocks `LOCKED` tenants without deleting any data) or **Продлить вручную** / **Сменить тариф**.

## 4. Reset Platform Admin Password or 2FA

Run CLI scripts inside the `backend` workspace (or `docker compose exec api ...`):

```bash
# Create a new PlatformAdmin
npm run admin:create -w backend -- --email admin@zapis.kg --name "Admin"

# Reset admin password
npm run admin:reset-password -w backend -- --email admin@zapis.kg

# Reset admin TOTP 2FA (requires re-enrollment on next login)
npm run admin:reset-2fa -w backend -- --email admin@zapis.kg
```

## 5. Outbox Queue (Retry / Cancel Stuck Notifications)

1. Check failed/pending messages in `/admin` or via SQL:
   ```sql
   SELECT id, channel, kind, status, attempts, "lastError", "scheduledFor"
   FROM "OutboxMessage"
   WHERE status IN ('PENDING', 'FAILED', 'DEAD')
   ORDER BY "scheduledFor" DESC LIMIT 50;
   ```
2. **Retry dead/failed**:
   ```sql
   UPDATE "OutboxMessage"
   SET status = 'PENDING', attempts = 0, "lockedAt" = NULL, "scheduledFor" = NOW()
   WHERE id = '<uuid>';
   ```
3. **Cancel**:
   ```sql
   UPDATE "OutboxMessage"
   SET status = 'CANCELLED'
   WHERE id = '<uuid>';
   ```

## 6. Secret Rotation

1. **Staff JWT (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`)**: Update secrets and restart `api`. Existing access tokens expire within `15m`; refresh tokens are invalidated (staff re-login).
2. **Admin JWT (`ADMIN_JWT_ACCESS_SECRET`, `ADMIN_JWT_REFRESH_SECRET`)**: Must remain distinct from staff secrets. Restart `api`.
3. **Admin TOTP Encryption (`ADMIN_TOTP_ENCRYPTION_KEY`)**: If rotated, admins must re-enroll 2FA (`npm run admin:reset-2fa -w backend -- --email ...`).
4. **Telegram Webhook (`TELEGRAM_WEBHOOK_SECRET`)**: Update in `.env`, restart `api`, and re-register webhook with Telegram Bot API `setWebhook` using the new `secret_token`.

### Telegram linking

- For local development, set `TELEGRAM_MODE=polling`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_BOT_USERNAME` (without `@`) in `backend/.env`, then restart the backend. The API receives commands independently of the outbox worker. Run only one API instance with polling for a given bot. A registered webhook must be removed before switching to polling; the app does not remove it automatically.
- For webhook deployment, set `TELEGRAM_MODE=webhook` and register the public HTTPS `/api/v1/telegram/webhook` URL with Telegram using `TELEGRAM_WEBHOOK_SECRET` as `secret_token`.
- In the profile, generate a fresh link, open the bot and press Start. The link expires after 15 minutes; the profile refreshes connection status automatically while linking is pending.
- Booking notification delivery still requires the outbox worker (`WORKER_ENABLED=true` or the standalone worker).
- Diagnose credentials with `getMe` and delivery configuration with `getWebhookInfo`. Never paste bot-token URLs or response payloads containing personal data into logs. HTTP 409 from polling usually indicates a competing receiver or an installed webhook.

## 7. Backup & Restore (PostgreSQL)

```bash
# Backup (custom format)
pg_dump -U zapis -Fc zapis > zapis_$(date -u +%Y%m%dT%H%M%SZ).dump

# Restore into a fresh database (ensure btree_gist extension is enabled)
createdb -U zapis zapis_restored
psql -U zapis -d zapis_restored -c "CREATE EXTENSION IF NOT EXISTS btree_gist;"
pg_restore -U zapis -d zapis_restored --no-owner --no-acl zapis_*.dump

# Verify migrations and exclusion constraint
DATABASE_URL="postgresql://zapis:...@localhost:5432/zapis_restored?schema=public" npx prisma migrate status --config backend/prisma.config.ts
psql -U zapis -d zapis_restored -tAc "SELECT conname FROM pg_constraint WHERE conname = 'Appointment_no_overlapping_active_slots';"
```

## 8. Handling Lapsed Trial / `LOCKED` Subscription

- When `Subscription.periodEndsAt` (plus grace if applicable) passes, the tenant enters `LOCKED` read-only mode.
- **No data is ever deleted**: staff can still view calendar/clients/analytics, export CSV, and access `/dashboard/billing` to submit/view invoices.
- Any mutating staff API call returns `402 SUBSCRIPTION_REQUIRED`.
- Confirming a paid invoice or extending the subscription in `/admin` immediately restores `ACTIVE` access.

## Портфолио мастеров (U2–U5)

- Применить `prisma migrate deploy` перед запуском новой сборки (миграция staff_portfolio).
- Медиа сохраняются в PostgreSQL и входят в обычный backup БД; отдельного публичного каталога нет.
- На мастера — 12 материалов. На компанию — 200 материалов / 100 MiB (резерв 25 MiB на обработку).
- JPEG/PNG/WebP: 8 MiB, 20 млн пикселей, один кадр; выдача WebP до 1600 px + превью 480 px, без EXIF.
- MP4: 20 MiB, до 30 секунд, вход до 1920×1920; H.264 без звука и metadata, с WebP-постером.
- Обработчик ограничен двумя задачами на процесс и одной на компанию. Временные файлы вне webroot удаляются в finally.
- Пустые PENDING после аварии удаляются при следующей загрузке спустя 5 минут. Повторная загрузка запускает обработку заново.
- Production Docker использует apk ffmpeg (`FFMPEG_PATH=/usr/bin/ffmpeg`, `FFPROBE_PATH=/usr/bin/ffprobe`). Локально — static packages. Native media codecs требуют регулярных security-обновлений образа.
- Удаление/замена материала удаляет его bytes атомарно. Soft-delete мастера очищает его медиа; неактивные мастера не имеют публичной выдачи.
- Telegram теперь подтверждает подключение через Outbox: для доставки ответа необходим работающий worker. Статус привязки не зависит от доступности провайдера.
