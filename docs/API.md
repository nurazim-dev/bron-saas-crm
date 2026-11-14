# Zapis.kg API Reference (v1)

Base path: `/api/v1`

## Envelope & Conventions
- **Success**: `{ "data": <payload>, "meta"?: { "page": number, "limit": number, "total": number } }` (or `204 No Content` for empty responses).
- **Error**:
  ```json
  {
    "error": {
      "code": "UPPER_SNAKE_CODE",
      "message": "Human-readable English message",
      "details": [{ "path": "field", "message": "Validation issue" }],
      "requestId": "uuid"
    }
  }
  ```
- **Headers**: Every response includes `X-Request-Id`.
- **Timestamps**: ISO-8601 UTC (`...Z`).
- **Phones**: Normalized to E.164 (`+996...`, default region `KG`).

---

## 1. Health

### `GET /api/v1/health`
Checks HTTP server and PostgreSQL connectivity (`SELECT 1`).
- **Auth**: None
- **Responses**:
  - `200 OK`: `{ "data": { "status": "ok", "database": "up", "uptimeSec": 12, "timestamp": "2026-11-14T09:00:00.000Z" } }`
  - `503 Service Unavailable`: `{ "data": { "status": "degraded", "database": "down", ... } }`

---

## 2. Authentication & Sessions (`/api/v1/auth`)

Refresh tokens are stored in an `httpOnly` cookie named `zapis_rt` (`SameSite=Lax`, `Path=/api/v1/auth`, `Secure` in production, TTL 30 days) and rotated on every refresh/login/register/password change.

### `POST /api/v1/auth/register`
Atomically creates a new `Company` (with auto-generated slug from `companyName`) and its `OWNER` user.
- **Auth**: None (Rate-limited: 10 req/min/IP)
- **Request Body**:
  ```json
  {
    "companyName": "Барбершоп Лорд",
    "businessType": "BARBERSHOP",
    "ownerName": "Азамат Токтогулов",
    "email": "owner@lord.kg",
    "phone": "0555 123 456",
    "password": "Password123!"
  }
  ```
  - `businessType`: `"BEAUTY_SALON" | "BARBERSHOP" | "AUTO_SERVICE" | "OTHER"` (optional, defaults to `"OTHER"`).
  - `phone`: optional; normalized to E.164 (`+996555123456`).
  - `password`: 8–128 chars.
- **Responses**:
  - `201 Created`: Sets `zapis_rt` cookie and returns `{ "data": { "accessToken": "...", "user": UserDto, "company": CompanyDto } }`.
  - `400 VALIDATION_ERROR`: Invalid input or phone format.
  - `409 CONFLICT`: Email already registered.
  - `429 RATE_LIMITED`: Rate limit exceeded.

### `POST /api/v1/auth/login`
Authenticates an active user with email and password.
- **Auth**: None (Rate-limited: 10 req/min/IP)
- **Request Body**:
  ```json
  {
    "email": "owner@lord.kg",
    "password": "Password123!"
  }
  ```
- **Responses**:
  - `200 OK`: Sets `zapis_rt` cookie and returns `{ "data": { "accessToken": "...", "user": UserDto, "company": CompanyDto } }`.
  - `401 UNAUTHENTICATED`: Invalid email or password (timing-equalized).
  - `429 RATE_LIMITED`: Rate limit exceeded.

### `POST /api/v1/auth/refresh`
Rotates the refresh cookie and issues a new access token.
- **Auth**: `zapis_rt` cookie. Rejects requests with a present `Origin` header not in `CORS_ORIGINS` (`403 FORBIDDEN`).
- **Responses**:
  - `200 OK`: Sets new `zapis_rt` cookie and returns `{ "data": { "accessToken": "...", "user": UserDto, "company": CompanyDto } }`.
  - `401 UNAUTHENTICATED`: Missing, expired, tampered, or revoked refresh token.
  - `403 FORBIDDEN`: Disallowed `Origin` header.

### `POST /api/v1/auth/logout`
Clears the `zapis_rt` cookie.
- **Auth**: None (checks `Origin` header if present).
- **Responses**:
  - `204 No Content`: Clears `zapis_rt` cookie.
  - `403 FORBIDDEN`: Disallowed `Origin` header.

### `GET /api/v1/auth/me`
Returns the currently authenticated user and their company.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` or `MASTER`)
- **Responses**:
  - `200 OK`: `{ "data": { "user": UserDto, "company": CompanyDto } }`
  - `401 UNAUTHENTICATED`: Missing, invalid, or revoked token.

### `PATCH /api/v1/auth/password`
Changes the authenticated user's password, increments `tokenVersion` (immediately invalidating all previous tokens), and issues a fresh access token + refresh cookie.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` or `MASTER`)
- **Request Body**:
  ```json
  {
    "currentPassword": "Password123!",
    "newPassword": "NewPassword456!"
  }
  ```
- **Responses**:
  - `200 OK`: Sets rotated `zapis_rt` cookie and returns `{ "data": { "accessToken": "...", "user": UserDto, "company": CompanyDto } }`.
  - `400 VALIDATION_ERROR`: Invalid new password length.
  - `401 UNAUTHENTICATED`: Incorrect `currentPassword` or invalid token.

---

## 3. Company (`/api/v1/company`)

### `GET /api/v1/company`
Returns the authenticated staff member's company profile and booking settings.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` or `MASTER`)
- **Responses**:
  - `200 OK`: `{ "data": CompanyDto }`
  - `401 UNAUTHENTICATED`

### `PATCH /api/v1/company`
Updates the authenticated owner's company profile and booking settings.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` only; `MASTER` receives `403 FORBIDDEN`)
- **Request Body** (all fields optional):
  ```json
  {
    "name": "Барбершоп Лорд Бишкек",
    "businessType": "BARBERSHOP",
    "phone": "+996555123456",
    "address": "г. Бишкек, пр. Чуй 150",
    "timezone": "Asia/Bishkek",
    "slug": "barbershop-lord",
    "slotIntervalMin": 30,
    "minLeadTimeMin": 60,
    "maxAdvanceDays": 60,
    "publicBookingEnabled": true
  }
  ```
  - `phone` and `address` accept `null` or `""` to clear.
  - `timezone`: validated against IANA time zones (`Luxon`).
  - `slug`: `[a-z0-9-]`, 3–40 chars, globally unique (including soft-deleted companies).
  - `slotIntervalMin`: 5–120; `minLeadTimeMin`: >= 0; `maxAdvanceDays`: 1–365.
- **Responses**:
  - `200 OK`: `{ "data": CompanyDto }`
  - `400 VALIDATION_ERROR`: Invalid field values, invalid phone, or invalid IANA timezone.
  - `401 UNAUTHENTICATED`
  - `403 FORBIDDEN`: Caller is not `OWNER`.
  - `409 CONFLICT`: `slug` is already taken by another company.
