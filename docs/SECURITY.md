# Zapis.kg — Security Architecture & Controls (`docs/SECURITY.md`)

This living document tracks all security controls, rate limits, cryptographic primitives, token lifecycles, tenant isolation boundaries, and redaction policies across **Zapis.kg**.

---

## 1. Authentication & Session Security

- **Password Hashing**: Native `argon2id` (`argon2` package) with constant-time verification. Login against unknown emails executes a dummy `argon2.verify` against a precomputed hash to equalize response timing (**BR-11**).
- **Staff Access Token**: Short-lived (`15m`) HS256 JWT (`typ: "access"`, `sub`, `companyId`, `role`, `tv`), held **exclusively in Zustand memory** on the frontend (never `localStorage` or `sessionStorage`).
- **Staff Refresh Token**: HS256 JWT (`typ: "refresh"`, `sub`, `companyId`, `role`, `tv`, `jti`) stored in an `httpOnly` cookie (`zapis_rt`, `SameSite=Lax`, `Path=/api/v1/auth`, `Secure` in production) and rotated on every refresh/login/register/password change.
- **Immediate Revocation (`tokenVersion`)**: `authenticate` middleware reloads the user from PostgreSQL on every request and verifies `user.isActive`, `user.deletedAt === null`, `company.deletedAt === null`, and `user.tokenVersion === claims.tv`. Password changes, password resets, deactivations, and soft-deletes increment `tokenVersion`.
- **CSRF / Origin Enforcement**: Cookie-bearing endpoints (`/api/v1/auth/refresh`, `/api/v1/auth/logout`) validate the `Origin` header against `CORS_ORIGINS` (`backend/src/middleware/origin-check.ts`).

---

## 2. Rate Limits Inventory

| Endpoint | Scope | Default Window & Limit | Env Override |
|----------|-------|------------------------|--------------|
| `POST /api/v1/auth/register` | Per IP | `10` requests / `1` minute | `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_AUTH_WINDOW_MS` |
| `POST /api/v1/auth/login` | Per IP | `10` requests / `1` minute | `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_AUTH_WINDOW_MS` |
| `POST /api/v1/auth/forgot-password` | Per IP / Per email hash | `5` / `1` hour (IP), `3` / `1` hour (email) | — |
| `POST /api/v1/auth/reset-password` | Per IP | `10` requests / `1` minute | `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_AUTH_WINDOW_MS` |
| `POST /api/v1/public/companies/:slug/appointments` | Per IP | `10` requests / `1` hour | `RATE_LIMIT_PUBLIC_BOOKING_MAX`, `RATE_LIMIT_PUBLIC_BOOKING_WINDOW_MS` |

*(Additional rate limiters for manage links and `/api/v1/admin/*` are added in Phases 15 and 19.)*

---

## 3. Tenant Isolation & Authorization (BR-5)

- **Tenant Resolution**:
  - Staff routes: `companyId` comes **exclusively** from `req.auth.companyId` (verified JWT + DB reload), never from request body, query, or route params.
  - Public routes: `companyId` is resolved **exclusively** from the verified `:slug` (or `:token` in Phase 19).
- **Cross-Tenant Object Access**: Queries for `Service`, `User`, `Appointment`, `Client`, `TimeOff`, etc. always include `companyId` in the `where` clause. Accessing an object belonging to another company (or a `MASTER` accessing another master's resource) returns `404 NOT_FOUND` (never `403 FORBIDDEN`) to prevent UUID enumeration.
- **Role Enforcement**: Endpoint-level role violations (`MASTER` calling an `OWNER`-only route) return `403 FORBIDDEN`.

---

## 4. Public Booking Anti-Abuse (BR-3)

- **Honeypot (`website`)**: If the hidden `website` field is non-empty on `POST /api/v1/public/companies/:slug/appointments`, the server returns a synthetic `201 Created` response without writing to PostgreSQL.
- **Per-Phone Cap**: At most `3` upcoming `SCHEDULED` appointments per normalized E.164 `clientPhone` per company (`409 CONFLICT`).
- **Input Sanitization**: Control characters (`\u0000-\u001F`, `\u007F`) are stripped from free-text inputs (`sanitizeText`), and phones are strictly validated and normalized to E.164 (`libphonenumber-js`, default region `KG`).

---

## 5. Logging Redaction & Secret Hygiene

- Structured JSON logging (`pino` in `backend/src/lib/logger.ts`) redacts sensitive paths (`req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`, `password`, `currentPassword`, `newPassword`, `token`, `resetToken`, `manageToken`, `mfaToken`, `recoveryCode`, `totp`, `secret`, `req.query.token`, `req.headers.referer`), and `scrubSensitiveUrl` strips `?token=` / `resetToken=` query parameters from logged request URLs.
- Password reset tokens are generated as 32 random bytes (`base64url`), stored at rest exclusively as SHA-256 hex digests (`PasswordResetToken.tokenHash`), expire in 60 minutes, are single-use, and are invalidated when a newer token is issued or password reset completes.
- `/reset-password` responds with `Referrer-Policy: no-referrer` and scrubs the `token` query parameter immediately via `history.replaceState`.
- Security tokens (password reset tokens, manage links, impersonation codes, TOTP secrets) are never logged and never echoed in error responses.
- Production startup (`NODE_ENV=production` in `backend/src/config/env.ts`) refuses weak or default secrets.
