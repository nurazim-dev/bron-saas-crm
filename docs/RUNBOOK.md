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
