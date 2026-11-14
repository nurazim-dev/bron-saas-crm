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

---

## 4. Services (`/api/v1/services`)

All prices are serialized as two-decimal strings (e.g. `"500.00"`).

### `GET /api/v1/services`
Lists services belonging to the authenticated staff member's company.
- **Auth**: `Authorization: Bearer <accessToken>`
  - `OWNER`: receives all non-deleted services (`isActive: true` and `false`).
  - `MASTER`: receives only active (`isActive: true`), non-deleted services.
- **Responses**:
  - `200 OK`: `{ "data": [ServiceDto, ...] }`

### `POST /api/v1/services`
Creates a new service for the owner's company.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` only)
- **Request Body**:
  ```json
  {
    "name": "Мужская стрижка",
    "description": "С мытьём головы и укладкой",
    "durationMin": 60,
    "price": "500.00",
    "isActive": true
  }
  ```
  - `name`: 2–100 chars.
  - `description`: optional, <= 500 chars or `null`.
  - `durationMin`: integer 5–720, multiple of 5.
  - `price`: number or decimal string in `0..1,000,000`.
  - `isActive`: optional boolean (defaults to `true`).
- **Responses**:
  - `201 Created`: `{ "data": ServiceDto }`
  - `400 VALIDATION_ERROR`
  - `403 FORBIDDEN`

### `GET /api/v1/services/:id`
Returns a single service by ID within the caller's company (`MASTER` can only access active services; cross-tenant IDs return `404 NOT_FOUND`).
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` or `MASTER`)
- **Responses**:
  - `200 OK`: `{ "data": ServiceDto }`
  - `404 NOT_FOUND`

### `PATCH /api/v1/services/:id`
Updates a service.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` only)
- **Request Body**: Any subset of `{ name, description, durationMin, price, isActive }`.
- **Responses**:
  - `200 OK`: `{ "data": ServiceDto }`
  - `400 VALIDATION_ERROR`
  - `403 FORBIDDEN`
  - `404 NOT_FOUND`

### `DELETE /api/v1/services/:id`
Soft-deletes a service (`deletedAt = now()`) and removes its `MasterService` links. Refuses if the service has upcoming (`startAt >= now`) `SCHEDULED` appointments (BR-7).
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` only)
- **Responses**:
  - `204 No Content`
  - `404 NOT_FOUND`
  - `409 HAS_UPCOMING_APPOINTMENTS`: Includes `upcomingAppointmentsCount` in `error.details[0]`.

---

## 5. Staff & Working Hours (`/api/v1/staff`)

`StaffDto` includes `hasLogin: boolean`, `serviceIds: string[]`, and `workingHours: [{ dayOfWeek, startTime, endTime }]`.

### `GET /api/v1/staff`
Lists all non-deleted staff members (`OWNER` and `MASTER`s) of the company.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` only; `MASTER` receives `403 FORBIDDEN`)
- **Responses**:
  - `200 OK`: `{ "data": [StaffDto, ...] }`

### `POST /api/v1/staff`
Creates a `MASTER` staff member. Login is optional: `email` and `password` must either both be provided or both be omitted. If `email` matches a soft-deleted `MASTER` of the **same** company, that record is restored and updated (§3.3); any other email collision returns `409 CONFLICT`.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` only)
- **Request Body**:
  ```json
  {
    "name": "Бекзат Исаков",
    "phone": "0700 11 22 33",
    "email": "bekzat@zapis.kg",
    "password": "Password123!",
    "isActive": true,
    "isBookable": true
  }
  ```
- **Responses**:
  - `201 Created`: `{ "data": StaffDto }`
  - `400 VALIDATION_ERROR`
  - `409 CONFLICT`

### `GET /api/v1/staff/:id`
Returns a staff member by ID, including `serviceIds` and `workingHours`. A `MASTER` may only read their own record (reading another staff member's ID returns `404 NOT_FOUND`).
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` or `MASTER` for self)
- **Responses**:
  - `200 OK`: `{ "data": StaffDto }`
  - `404 NOT_FOUND`

### `PATCH /api/v1/staff/:id`
Updates a staff member (`name`, `phone`, `email`, `password`, `isActive`, `isBookable`). Changing `password`, setting `isActive: false`, or clearing `email` increments `tokenVersion` so existing sessions are revoked immediately. The `OWNER` may update their own `name`, `phone`, `email`, `password`, and `isBookable`, but cannot set `isActive: false` or clear their own login.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` only)
- **Responses**:
  - `200 OK`: `{ "data": StaffDto }`
  - `400 VALIDATION_ERROR`
  - `404 NOT_FOUND`
  - `409 CONFLICT`

### `DELETE /api/v1/staff/:id`
Soft-deletes a `MASTER` record, clears their `MasterService` and `WorkingHours` links, and increments `tokenVersion`. The `OWNER` cannot delete himself (`403 FORBIDDEN`). Refuses with `409 HAS_UPCOMING_APPOINTMENTS` (with count) if the master has upcoming `SCHEDULED` appointments (BR-7).
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` only)
- **Responses**:
  - `204 No Content`
  - `403 FORBIDDEN`: Attempted to delete the `OWNER`.
  - `404 NOT_FOUND`
  - `409 HAS_UPCOMING_APPOINTMENTS`

### `PUT /api/v1/staff/:id/services`
Replaces the full set of services performed by a staff member (`OWNER` or `MASTER`). Every `serviceId` must belong to the same company and not be soft-deleted.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` only)
- **Request Body**:
  ```json
  {
    "serviceIds": ["uuid-1", "uuid-2"]
  }
  ```
- **Responses**:
  - `200 OK`: `{ "data": StaffDto }`
  - `400 VALIDATION_ERROR`: Unknown, cross-tenant, or deleted `serviceId`.
  - `404 NOT_FOUND`

### `PUT /api/v1/staff/:id/working-hours`
Replaces the weekly working-hours schedule for a staff member (BR-10). `dayOfWeek` is ISO (`1` = Monday ... `7` = Sunday), `startTime < endTime` in `"HH:mm"` format on the same day. Omitted weekdays are days off.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` only)
- **Request Body**:
  ```json
  {
    "days": [
      { "dayOfWeek": 1, "startTime": "10:00", "endTime": "20:00" },
      { "dayOfWeek": 2, "startTime": "10:00", "endTime": "20:00" }
    ]
  }
  ```
- **Responses**:
  - `200 OK`: `{ "data": StaffDto }`
  - `400 VALIDATION_ERROR`
  - `404 NOT_FOUND`
