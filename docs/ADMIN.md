# Platform Admin & Support Security (`docs/ADMIN.md`)

Platform Operators (`PlatformAdmin`) are strictly isolated from tenant `User` accounts.

---

## 1. Identity & Token Isolation (BR-20)

- **Separate table**: `PlatformAdmin` (never `User`, never in `Role` enum).
- **Separate tokens & secrets**:
  - Access JWT (`10m`, `aud: "zapis-admin"`, `typ: "admin_access"`) signed with `ADMIN_JWT_ACCESS_SECRET`.
  - Refresh JWT (`7d`, `aud: "zapis-admin"`, `typ: "admin_refresh"`, cookie `zapis_admin_rt`, `HttpOnly`, `SameSite=Strict`, `Path=/api/v1/admin/auth`) signed with `ADMIN_JWT_REFRESH_SECRET`.
  - Staff tokens on `/api/v1/admin/*` and admin tokens on staff routes both return `401 UNAUTHENTICATED`.
- **Rate Limits & Lockout**:
  - `POST /api/v1/admin/auth/login`: `5/min/IP`; 10 failed attempts per email within 15 minutes sets `lockedUntil` for 15 minutes.
  - `POST /api/v1/admin/auth/mfa`: `5/min/IP`.
  - `POST /api/v1/auth/impersonate/exchange`: `10/min/IP`.

---

## 2. Two-Factor Authentication (TOTP)

- Implemented with `otplib` (`epochTolerance: 30` for `+-1` step) and `lastTotpStep` replay protection.
- TOTP secrets are encrypted at rest with **AES-256-GCM** using `ADMIN_TOTP_ENCRYPTION_KEY` (32-byte base64).
- When `ADMIN_REQUIRE_2FA=true` (default in `production`), admins without 2FA receive an `enroll`-scoped token that can ONLY call `/api/v1/admin/auth/2fa/enroll` and `/2fa/verify-enroll`.
- Enabling 2FA generates 8 single-use recovery codes (stored as SHA-256 hex hashes).

---

## 3. CLI Bootstrap & Recovery

```bash
npm run admin:create -- --email admin@example.com --name "Operator" --password "StrongPassword12!"
npm run admin:reset-password -- --email admin@example.com --password "NewStrongPassword12!"
npm run admin:reset-2fa -- --email admin@example.com
```

In development (`npm run db:seed`), a dev-only admin `admin@demo.zapis.kg` / `AdminDemo12345!` is seeded (`NODE_ENV !== 'production'`).

---

## 4. Impersonation & Suspension Policy

- **Impersonation**: `POST /api/v1/admin/companies/:id/impersonate { reason }` issues a single-use 60-second code (stored SHA-256 hashed). Exchanging via `POST /api/v1/auth/impersonate/exchange` returns a 30-minute read-only `OWNER` access token (`imp: adminId`, no refresh cookie). All non-GET requests return `403 IMPERSONATION_READ_ONLY`. Start, exchange, and exit (`/auth/impersonate/exit`) are audited.
- **Suspension**: `POST /api/v1/admin/companies/:id/suspend { reason }` blocks all staff requests with `403 COMPANY_SUSPENDED`, disables public booking (`403 BOOKING_DISABLED`), and skips worker billing notifications.
- **No End-Client PII**: Admin endpoints expose company profiles, staff contacts, and aggregate counts only — never end-client names or phones.
