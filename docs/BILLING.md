# Billing & Subscriptions Architecture (`docs/BILLING.md`)

Zapis.kg uses a manual-payment subscription model (no online acquiring). Every company receives a trial subscription atomically on registration.

---

## 1. Plans & Default Settings

Seeded idempotently via `backend/prisma/migrations/20261116051413_billing_core/migration.sql` (`ON CONFLICT DO NOTHING`):

| Plan Code | Name | Price / Month | `maxStaff` | Analytics | Auto-Reminders | Prepayment | Monthly Reminder Cap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `START` | Старт | `990.00` KGS | `2` | No | No | No | `0` |
| `BUSINESS` | Бизнес | `1990.00` KGS | `7` | Yes | Yes | Yes | `1000` |
| `PRO` | Про | `3990.00` KGS | `30` | Yes | Yes | Yes | `5000` |

`PlatformSetting` defaults: `trialDays = 14`, `graceDays = 3`, `trialPlanCode = "BUSINESS"`, `registrationOpen = true`.

---

## 2. Subscription State Machine (`computeBillingState`)

Implemented as a pure function in `backend/src/modules/billing/billing-state.ts`:

- `now < periodEndsAt`: **`TRIAL`** (if `isTrial = true`) or **`ACTIVE`** (if `isTrial = false`).
- `periodEndsAt <= now < periodEndsAt + graceDays`: **`PAST_DUE`** (grace period — all features work, owner sees warning banner).
- `now >= periodEndsAt + graceDays`: **`LOCKED`** (read-only mode — **data is never deleted**).

All gating uses `computeBillingState` in real time. The worker job `billing-state-sync` keeps `Subscription.status` synchronized for filtering.

---

## 3. Gating Rules (BR-19)

- **LOCKED write-block (`requireWritableSubscription`)**:
  - Returns `402 SUBSCRIPTION_REQUIRED` on mutating staff requests (`POST`, `PUT`, `PATCH`, `DELETE`), **except** the allowlist: `/api/v1/auth/*`, `/api/v1/billing/*`, `/api/v1/notifications/*`, `/api/v1/health`, `/api/v1/exports/*`.
  - All `GET` endpoints continue to work.
  - Public booking & availability (`/api/v1/public/companies/:slug*`) return `403 BOOKING_DISABLED`.
- **Staff limit (`assertWithinStaffLimit`)**:
  - Counts active non-deleted users (`isActive = true, deletedAt = null`, `OWNER` included).
  - Creating, reactivating, or restoring a staff member beyond `plan.maxStaff` returns `402 PLAN_LIMIT_REACHED`.
  - Downgrading below current usage is allowed; new additions are blocked until usage is within limit.
- **Feature gates (`requireFeature`)**:
  - Returns `402 FEATURE_NOT_IN_PLAN` when the company's plan lacks the required feature.

---

## 4. Manual Payment Claims & Confirmation Math

- Owners submit a claim (`POST /api/v1/billing/payments`) specifying `{ planId, months (1|3|6|12), method, reference?, comment? }`.
- Amount is computed strictly server-side (`plan.priceMonthly * months`).
- Only **one** `PENDING` claim per company is allowed (enforced both in service logic and by PostgreSQL partial unique index `SubscriptionPayment_one_pending_per_company` -> `409 PAYMENT_CLAIM_PENDING`).
- Confirmation (`confirmPayment`, exposed to Platform Admin in Phase 15):
  - **Same plan**: `periodStartsAt = max(now, current.periodEndsAt)`, `periodEndsAt = periodStartsAt + months` (UTC calendar months via Luxon).
  - **Plan switch**: takes effect immediately (`periodStartsAt = now`), `periodEndsAt = now + months + remainingWholeDaysOfOldPeriod`.
  - Sets `isTrial = false`, `status = ACTIVE`, notifies owner (outbox email + in-app), and writes `AuditLog`.
