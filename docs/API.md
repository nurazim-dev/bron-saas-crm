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
Checks HTTP server, PostgreSQL connectivity (`SELECT 1`), and background worker heartbeat freshness (`WorkerHeartbeat`).
- **Auth**: None
- **Responses**:
  - `200 OK`: `{ "data": { "status": "ok" | "degraded", "database": "up", "worker": { "status": "up" | "stale" | "disabled", "lastBeatAt": "2026-11-14T09:00:00.000Z" | null }, "uptimeSec": 12, "timestamp": "2026-11-14T09:00:00.000Z" } }`
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
  - `businessType`: `"BARBERSHOP" | "BEAUTY_SALON"` (optional, defaults to `"BARBERSHOP"`).
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
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER`, `MANAGER`, or `MASTER`)
- **Responses**:
  - `200 OK`: `{ "data": { "user": UserDto, "company": CompanyDto } }`
  - `401 UNAUTHENTICATED`: Missing, invalid, or revoked token.

### `GET /api/v1/auth/companies`
Lists all active company memberships belonging to the authenticated account's `Identity` (during read-only impersonation, returns only the impersonated company).
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER`, `MANAGER`, or `MASTER`)
- **Responses**:
  - `200 OK`: `{ "data": CompanyMembershipDto[] }` (`companyId`, `companyName`, `companySlug`, `businessType`, `role`, `isCurrent`, `isSuspended`)
  - `401 UNAUTHENTICATED`

### `POST /api/v1/auth/companies`
Creates an additional company under the authenticated owner's shared `Identity`, creates a new `OWNER` membership for it with a trial subscription, revokes the current session, and issues a fresh access token + `zapis_rt` cookie scoped to the new company.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` only; `MANAGER` / `MASTER` receive `403 FORBIDDEN`; impersonation returns `403 IMPERSONATION_READ_ONLY`)
- **Request Body**: `{ "companyName": "...", "businessType"?: "BARBERSHOP" | "BEAUTY_SALON", "phone"?: "+996..." }`
- **Responses**:
  - `201 Created`: `{ "data": { "accessToken": "...", "user": UserDto, "company": CompanyDto } }`
  - `409 COMPANY_LIMIT_REACHED`: Maximum companies per identity (20) reached.

### `POST /api/v1/auth/switch-company`
Explicitly switches the active session to another company where the authenticated `Identity` holds an active membership. Revokes the previous session (`sid`), updates `lastCompanyId`, and issues a fresh access token + `zapis_rt` cookie with that membership's `userId`, `companyId`, and `role`.
- **Auth**: `Authorization: Bearer <accessToken>` (impersonation returns `403 IMPERSONATION_READ_ONLY`)
- **Request Body**: `{ "companyId": "uuid" }` (strict schema; extra fields such as `role` return `400 VALIDATION_ERROR`)
- **Responses**:
  - `200 OK`: `{ "data": { "accessToken": "...", "user": UserDto, "company": CompanyDto } }`
  - `403 COMPANY_SUSPENDED`: Target company is suspended.
  - `404 NOT_FOUND`: Target company does not exist or the identity has no active membership in it.

> **Shared-identity staff protection**: When a staff member's `Identity` also belongs to another company, staff-management credential updates (`PATCH /api/v1/staff/:id` changing `email` or `password`, and `POST /api/v1/staff/:id/password-reset-link`) return `409 SHARED_IDENTITY`.

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

### `POST /api/v1/auth/forgot-password`
Requests a password reset email. Always returns `202 Accepted` with an identical body regardless of whether the email exists or is active (prevents account enumeration, BR-13). Rate-limited to `5/hour/IP` and `3/hour/email`.
- **Auth**: None
- **Request Body**: `{ "email": "owner@lord.kg" }`
- **Responses**:
  - `202 Accepted`: `{ "data": { "message": "If an account with that email exists, we have sent password reset instructions." } }`
  - `429 RATE_LIMITED`

### `GET /api/v1/auth/reset-password/validate?token=...`
Validates a password reset token without consuming it.
- **Auth**: None
- **Responses**:
  - `200 OK`: `{ "data": { "valid": true | false } }`

### `POST /api/v1/auth/reset-password`
Resets the user's password using a single-use token (60-minute TTL), invalidates all other tokens of the user, increments `tokenVersion` (revoking all active sessions), and records an audit log entry.
- **Auth**: None
- **Request Body**: `{ "token": "...", "newPassword": "NewPassword123!" }`
- **Responses**:
  - `204 No Content`
  - `400 INVALID_OR_EXPIRED_TOKEN`: Missing, used, or expired token.
  - `400 VALIDATION_ERROR`: Password policy violation.

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

### Staff permissions

| Capability | OWNER | MANAGER | MASTER |
| --- | --- | --- | --- |
| Appointments, availability, time off and reminders | Company-wide | Company-wide | Own schedule |
| Client directory and history | Company-wide | Company-wide | Own clients and visits |
| Mark prepayment received or waive it | Company-wide | Company-wide | Own appointments |
| Refunds, appointment deletion and reactivation | Company-wide | Forbidden | Forbidden |
| Staff administration, catalog changes, client edits and erasure, billing and analytics | Company-wide | Forbidden | Forbidden |

Operational writes require a writable subscription. Manager accounts are excluded from staff and public booking choices.

### `GET /api/v1/staff`
Lists non-deleted staff of the company. A manager sees bookable staff with `email` and `phone` set to `null` and `hasLogin` set to `false`.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` or `MANAGER`; `MASTER` receives `403 FORBIDDEN`)
- **Responses**:
  - `200 OK`: `{ "data": [StaffDto, ...] }`

### `POST /api/v1/staff/invite`

An owner with a writable subscription may invite a staff member by sending `name`, `email`, and optional `role` (`MASTER` by default, or `MANAGER`). Returns `201` with `{ "data": { "id": "...", "url": "...", "expiresAt": "..." } }`. The invitation queues an email and counts toward the active staff limit. The link is single-use and expires after 60 minutes. The employee sets their own password.

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
Returns a staff member by ID, including `serviceIds` and `workingHours`. A `MASTER` may read their own record. A `MANAGER` may read their own record and the bookable staff records visible in the directory.
- **Auth**: `Authorization: Bearer <accessToken>`
- **Responses**:
  - `200 OK`: `{ "data": StaffDto }`
  - `404 NOT_FOUND`

### `PATCH /api/v1/staff/:id`
Updates a staff member (`name`, `phone`, `email`, `password`, `isActive`, `isBookable`). Changing email or password or deactivating an account invalidates existing sessions and unused reset links. Owners must retain an active login. Managers must retain a login email and have `isBookable: false`.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` only)
- **Responses**:
  - `200 OK`: `{ "data": StaffDto }`
  - `400 VALIDATION_ERROR`
  - `404 NOT_FOUND`
  - `409 CONFLICT`

### `DELETE /api/v1/staff/:id`
Soft-deletes a `MASTER` or `MANAGER` record, clears their `MasterService` and `WorkingHours` links, and increments `tokenVersion`. Deleting an owner returns `403 FORBIDDEN`. Refuses with `409 HAS_UPCOMING_APPOINTMENTS` (with count) if the master has upcoming `SCHEDULED` appointments (BR-7).
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

### `POST /api/v1/staff/:id/password-reset-link`
Generates a single-use password reset link (60-minute TTL) for an active `MASTER` or `MANAGER` with an email in the same company. The audit log records the action.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` only)
- **Request Body** (optional): `{ "sendEmail": false }` (`true` also enqueues `PASSWORD_RESET` email)
- **Responses**:
  - `200 OK`: `{ "data": { "url": "http://localhost:3000/reset-password?token=...", "expiresAt": "2026-11-16T11:00:00.000Z" } }`
  - `403 FORBIDDEN`: Caller is not `OWNER`.
  - `404 NOT_FOUND`: Staff member outside the caller's company, inactive, an owner, or missing a login email.

---

## 6. Appointments (`/api/v1/appointments`)

All appointments carry `startAt` and `endAt` as ISO-8601 UTC instants (`...Z`), `price` as a two-decimal string (`"700.00"`), `service: { id, name, durationMin }`, and `master: { id, name }` (preserved even if the service or master was later soft-deleted).

### `GET /api/v1/appointments`
Lists non-deleted appointments overlapping the half-open UTC window `[from, to)` (`startAt < to AND endAt > from`), sorted by `startAt ASC`.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` or `MASTER`; a `MASTER` is always forced to their own `masterId`).
- **Query Parameters**:
  - `from` (required): ISO-8601 instant (inclusive).
  - `to` (required): ISO-8601 instant (exclusive, `from < to`, range `<= 62` days).
  - `masterId` (optional): UUID filter (ignored for `MASTER` callers).
  - `status` (optional): `"SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW"`.
  - `page` (optional, default `1`): integer `>= 1`.
  - `limit` (optional, default `50`): integer `1..200`.
- **Responses**:
  - `200 OK`: `{ "data": [AppointmentDto, ...], "meta": { "page": 1, "limit": 50, "total": 12 } }`
  - `400 VALIDATION_ERROR`: Missing/invalid dates or range exceeds 62 days.

### `POST /api/v1/appointments`
Creates a staff appointment (`source = "STAFF"`). Enforces **BR-1** (`FOR UPDATE` row lock on master + half-open overlap check + PostgreSQL GiST exclusion constraint), **BR-2** (computes `endAt = startAt + service.durationMin`, normalizes seconds/ms to `0`, snapshots `service.price` unless `price` override is provided), and **BR-8** (normalizes `clientPhone` to E.164). Staff bookings may be placed outside working hours or off-grid, but never overlap an active appointment.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` for any active bookable master in the company; `MASTER` only for self).
- **Request Body**:
  ```json
  {
    "masterId": "uuid",
    "serviceId": "uuid",
    "startAt": "2026-11-20T10:00:00+06:00",
    "clientName": "Бакыт Асанов",
    "clientPhone": "0555 77 88 99",
    "clientNote": "Покороче по бокам",
    "internalNote": "Постоянный клиент",
    "price": "700.00"
  }
  ```
- **Responses**:
  - `201 Created`: `{ "data": AppointmentDto }`
  - `400 VALIDATION_ERROR`: Invalid fields, inactive/non-bookable master or service, or master not linked to service.
  - `403 FORBIDDEN`: `MASTER` attempting to create for another master.
  - `404 NOT_FOUND`: Unknown or cross-tenant `masterId` / `serviceId`.
  - `409 SLOT_ALREADY_BOOKED`: Another `SCHEDULED` or `COMPLETED` appointment overlaps `[startAt, endAt)`.

### `GET /api/v1/appointments/:id`
Returns a single appointment by ID (`MASTER` may only read own appointments; cross-tenant or other-master IDs return `404 NOT_FOUND`).
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` or `MASTER`)
- **Responses**:
  - `200 OK`: `{ "data": AppointmentDto }`
  - `404 NOT_FOUND`

### `PATCH /api/v1/appointments/:id`
Updates details, reschedules, or changes `serviceId` / `masterId` of an appointment. Allowed **only while `status === "SCHEDULED"`** (BR-6). Re-runs **BR-1** excluding the appointment itself. If `serviceId` changes, recomputes `endAt` and updates `price` snapshot (unless `price` is explicitly provided in the payload).
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` or `MASTER` for own appointment)
- **Request Body**: Any non-empty subset of `{ masterId, serviceId, startAt, clientName, clientPhone, clientNote, internalNote, price }`.
- **Responses**:
  - `200 OK`: `{ "data": AppointmentDto }`
  - `400 VALIDATION_ERROR`
  - `403 FORBIDDEN`: `MASTER` attempting to reassign `masterId`.
  - `404 NOT_FOUND`
  - `409 INVALID_STATUS_TRANSITION`: Appointment is not `SCHEDULED`.
  - `409 SLOT_ALREADY_BOOKED`: Target slot conflicts with another active appointment.

### `POST /api/v1/appointments/:id/status`
Transitions an appointment's status according to **BR-6**:
- `SCHEDULED -> CANCELLED`: allowed for `OWNER` and own `MASTER` (frees the slot).
- `SCHEDULED -> COMPLETED | NO_SHOW`: allowed for `OWNER` and own `MASTER` **only when `startAt <= now`** (`NO_SHOW` frees the slot; `COMPLETED` keeps blocking it).
- `CANCELLED -> SCHEDULED`: allowed **only for `OWNER`** (re-runs **BR-1** and returns `409 SLOT_ALREADY_BOOKED` if the slot was taken).
- Any other transition returns `409 INVALID_STATUS_TRANSITION`.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` or `MASTER` for own appointment)
- **Request Body**: `{ "status": "COMPLETED" | "CANCELLED" | "NO_SHOW" | "SCHEDULED" }`
- **Responses**:
  - `200 OK`: `{ "data": AppointmentDto }`
  - `403 FORBIDDEN`: `MASTER` attempting `CANCELLED -> SCHEDULED`.
  - `404 NOT_FOUND`
  - `409 INVALID_STATUS_TRANSITION`
  - `409 SLOT_ALREADY_BOOKED`

### `DELETE /api/v1/appointments/:id`
Soft-deletes an erroneous appointment (`deletedAt = now()`, freeing the slot). Normal cancellations should use `POST /api/v1/appointments/:id/status` with `status: "CANCELLED"`.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` only; `MASTER` receives `403 FORBIDDEN`)
- **Responses**:
  - `204 No Content`
  - `403 FORBIDDEN`
  - `404 NOT_FOUND`

---

## 7. Availability (`/api/v1/availability`)

### `GET /api/v1/availability`
Computes available booking slots for a given `serviceId`, `masterId`, and company-local calendar `date` (`YYYY-MM-DD`) using the shared **BR-4** engine.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` for any master in the company; `MASTER` only for self — another master's ID returns `404 NOT_FOUND`).
- **Query Parameters**:
  - `serviceId` (required): UUID.
  - `masterId` (required): UUID.
  - `date` (required): `YYYY-MM-DD` (interpreted in `Company.timezone`).
- **Responses**:
  - `200 OK`:
    ```json
    {
      "data": {
        "date": "2026-11-20",
        "timezone": "Asia/Bishkek",
        "slots": [
          { "startAt": "2026-11-20T04:00:00.000Z", "label": "10:00" },
          { "startAt": "2026-11-20T04:30:00.000Z", "label": "10:30" }
        ]
      }
    }
    ```
  - `400 VALIDATION_ERROR`: Invalid query params, inactive/unbookable master or service, or master not linked to service.
  - `404 NOT_FOUND`: Unknown, cross-tenant, or other-master `masterId` / `serviceId`.

---

## 8. Public Booking API (`/api/v1/public`)

Public endpoints require no authentication, resolve the tenant strictly by `:slug`, and expose only public-safe fields (never emails, staff phones, password hashes, or internal notes). If `publicBookingEnabled === false`, all three endpoints return `403 BOOKING_DISABLED`.

### `GET /api/v1/public/companies/:slug`
Returns the public company profile, active non-deleted services, and actually bookable masters (`isActive: true`, `isBookable: true`, `>= 1` assigned active service, and `>= 1` working-hours row).
- **Auth**: None
- **Responses**:
  - `200 OK`:
    ```json
    {
      "data": {
        "company": {
          "name": "Demo Barbershop",
          "slug": "demo-barbershop",
          "businessType": "BARBERSHOP",
          "phone": "+996555000111",
          "address": "г. Бишкек, пр. Чуй 125",
          "timezone": "Asia/Bishkek",
          "currency": "KGS",
          "bookingEnabled": true,
          "maxAdvanceDays": 60
        },
        "services": [
          {
            "id": "uuid",
            "name": "Мужская стрижка",
            "description": "Мытьё и укладка",
            "durationMin": 60,
            "price": "500.00"
          }
        ],
        "masters": [
          {
            "id": "uuid",
            "name": "Тимур Кадыров",
            "serviceIds": ["uuid"]
          }
        ]
      }
    }
    ```
  - `403 BOOKING_DISABLED`: `publicBookingEnabled` is `false`.
  - `404 NOT_FOUND`: Unknown or soft-deleted `slug`.

### `GET /api/v1/public/companies/:slug/availability`
Computes available slots for public booking (**BR-4**, **BR-12**) and sets `Cache-Control: no-store`.
- **Auth**: None
- **Query Parameters**:
  - `serviceId` (required): UUID.
  - `masterId` (optional): UUID or `"ANY"`. When omitted or `"ANY"`, returns the sorted union of free slots across all active, bookable masters who perform `serviceId` (**BR-12**).
  - `date` (required): `YYYY-MM-DD`.
- **Responses**:
  - `200 OK`: `{ "data": { "date": "2026-11-20", "timezone": "Asia/Bishkek", "slots": [{ "startAt": "...Z", "label": "10:00" }] } }` (with `Cache-Control: no-store`).
  - `400 VALIDATION_ERROR`: Invalid parameters or unbookable/unlinked master/service.
  - `403 BOOKING_DISABLED`
  - `404 NOT_FOUND`

### `POST /api/v1/public/companies/:slug/appointments`
Creates a client online booking (`source = "ONLINE"`). Enforces **BR-3**, **BR-4**, **BR-1**, **BR-8**, and **BR-12** inside a locked transaction:
- Rate-limited to `10` requests / hour / IP (`429 RATE_LIMITED`).
- Honeypot field `website`: if non-empty, returns a synthetic `201 Created` response and writes nothing to the database.
- If `masterId` is omitted, `null`, or `"ANY"` (**BR-12**), candidate masters (active, bookable, linked to `serviceId`) are ordered deterministically by `(fewest appointments on that local day ASC, id ASC)` and attempted one by one, locking strictly one master at a time and falling back across remaining candidates on `SLOT_ALREADY_BOOKED` / `SLOT_NOT_AVAILABLE`.
- Validates that `startAt` lies on the master's slot grid within working hours for that weekday in `Company.timezone` and satisfies `now + minLeadTimeMin <= startAt <= now + maxAdvanceDays` (`422 SLOT_NOT_AVAILABLE`).
- Enforces **BR-1** (`409 SLOT_ALREADY_BOOKED` on overlap).
- Enforces at most `3` upcoming `SCHEDULED` appointments per normalized `clientPhone` per company (`409 CONFLICT`).
- **Auth**: None (Rate-limited)
- **Request Body**:
  ```json
  {
    "serviceId": "uuid",
    "masterId": "uuid-or-ANY",
    "startAt": "2026-11-20T04:00:00.000Z",
    "clientName": "Айбек Сатыбалдиев",
    "clientPhone": "0555 123 456",
    "clientNote": "Пожалуйста, без филировки",
    "website": ""
  }
  ```
- **Responses**:
  - `201 Created`:
    ```json
    {
      "data": {
        "appointment": {
          "id": "uuid",
          "startAt": "2026-11-20T04:00:00.000Z",
          "endAt": "2026-11-20T05:00:00.000Z",
          "status": "SCHEDULED",
          "service": { "name": "Мужская стрижка", "durationMin": 60, "price": "500.00" },
          "master": { "name": "Тимур Кадыров" },
          "company": {
            "name": "Demo Barbershop",
            "address": "г. Бишкек, пр. Чуй 125",
            "phone": "+996555000111",
            "timezone": "Asia/Bishkek"
          }
        }
      }
    }
    ```
  - `400 VALIDATION_ERROR`
  - `403 BOOKING_DISABLED`
  - `404 NOT_FOUND`
  - `409 SLOT_ALREADY_BOOKED`: Slot is already taken.
  - `409 CONFLICT`: Phone number already has 3 upcoming scheduled appointments in this company.
  - `422 SLOT_NOT_AVAILABLE`: Off-grid, outside working hours, day off, past/lead-time violation, or beyond `maxAdvanceDays`.
  - `429 RATE_LIMITED`: IP rate limit exceeded.

---

## 8. In-App Notifications (`/api/v1/notifications`)

Scoped strictly to the authenticated user (`companyId` + `userId` from verified JWT). Cross-tenant or cross-user IDs return `404 NOT_FOUND`.

### `GET /api/v1/notifications`
Lists notifications for the current user, ordered by `createdAt DESC`.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` or `MASTER`)
- **Query Parameters**:
  - `page` (optional, default `1`): integer `>= 1`
  - `limit` (optional, default `20`): integer `1..100`
  - `unreadOnly` (optional): `"true" | "false"`
- **Responses**:
  - `200 OK`: `{ "data": [InAppNotificationDto, ...], "meta": { "page": 1, "limit": 20, "total": 4 } }`

### `GET /api/v1/notifications/unread-count`
Returns the unread notification count for the current user.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` or `MASTER`)
- **Responses**:
  - `200 OK`: `{ "data": { "unreadCount": 2 } }`

### `POST /api/v1/notifications/:id/read`
Marks a single notification as read (`readAt = now()`). Idempotent if already read.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` or `MASTER`)
- **Responses**:
  - `200 OK`: `{ "data": InAppNotificationDto }`
  - `404 NOT_FOUND`: Notification does not exist or belongs to another user/company.

### `POST /api/v1/notifications/read-all`
Marks all unread notifications for the current user as read.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` or `MASTER`)
- **Responses**:
  - `200 OK`: `{ "data": { "updatedCount": 3 } }`

---

## 9. Billing & Public Platform (`/api/v1/billing`, `/api/v1/public/platform`)

### `GET /api/v1/public/platform`
Returns public active plans, support contacts, platform announcement, and `registrationOpen` flag (cached for 60 seconds).
- **Auth**: None
- **Responses**:
  - `200 OK`: `{ "data": { "plans": [PlanDto, ...], "support": { "phone", "whatsapp", "email" }, "announcement": { "enabled", "text" }, "registrationOpen": true } }`

### `GET /api/v1/billing`
Returns the current company's subscription state (`TRIAL | ACTIVE | PAST_DUE | LOCKED`), days left, active staff usage vs. `maxStaff`, pending payment claim, and payment instructions.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` only)
- **Responses**:
  - `200 OK`: `{ "data": BillingOverviewDto }`

### `GET /api/v1/billing/plans`
Lists active public subscription plans ordered by `sortOrder`.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` only)

### `GET /api/v1/billing/payments`
Lists paginated payment claims and confirmed payments for the company.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` only)

### `POST /api/v1/billing/payments`
Creates a manual payment claim (`PENDING`). Amount is computed server-side (`priceMonthly * months`). Only one `PENDING` claim per company is permitted.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` only)
- **Request Body**: `{ "planId": "uuid", "months": 1 | 3 | 6 | 12, "method": "MBANK", "reference"?: "...", "comment"?: "..." }`
- **Responses**:
  - `201 Created`: `{ "data": SubscriptionPaymentDto }`
  - `409 PAYMENT_CLAIM_PENDING`

### `DELETE /api/v1/billing/payments/:id`
Cancels the company's own `PENDING` payment claim.
- **Auth**: `Authorization: Bearer <accessToken>` (`OWNER` only)
- **Responses**:
  - `200 OK`: `{ "data": SubscriptionPaymentDto }`
  - `404 NOT_FOUND`
  - `409 ALREADY_REVIEWED`

---

## 10. Platform Admin & Impersonation (`/api/v1/admin/*`, `/api/v1/auth/impersonate/*`)

All `/api/v1/admin/*` routes require `aud: "zapis-admin"` JWTs (`ADMIN_JWT_ACCESS_SECRET`) and never expose end-client PII. See `docs/ADMIN.md` for full security policy.

- **Admin Auth (`/api/v1/admin/auth`)**:
  - `POST /login`, `POST /mfa`, `POST /2fa/enroll`, `POST /2fa/verify-enroll`, `POST /refresh`, `POST /logout`, `GET /me`, `PATCH /password`
- **Metrics**:
  - `GET /api/v1/admin/metrics/overview` (companies by effective state, signups 7/30d, MRR, confirmed payments this month, appointments 30d, failed outbox count)
  - `GET /api/v1/admin/metrics/signups?days=30`
- **Companies**:
  - `GET /api/v1/admin/companies`, `GET /api/v1/admin/companies/:id`, `PATCH /api/v1/admin/companies/:id`
  - `POST /api/v1/admin/companies/:id/suspend`, `POST /api/v1/admin/companies/:id/unsuspend`
  - `DELETE /api/v1/admin/companies/:id` (`{ confirmSlug }`), `POST /api/v1/admin/companies/:id/restore`
  - `POST /api/v1/admin/companies/:id/impersonate` (`{ reason }` -> `{ code, expiresAt }`)
- **Impersonation (Staff side)**:
  - `POST /api/v1/auth/impersonate/exchange` (`{ code }` -> 30m read-only access token, no refresh cookie)
  - `POST /api/v1/auth/impersonate/exit` (`204`, audited)
- **Subscriptions, Payments & Plans**:
  - `PUT /api/v1/admin/companies/:id/subscription`, `POST /api/v1/admin/companies/:id/payments`
  - `GET /api/v1/admin/payments`, `POST /api/v1/admin/payments/:id/confirm`, `POST /api/v1/admin/payments/:id/reject`
  - `GET /api/v1/admin/plans`, `POST /api/v1/admin/plans`, `PATCH /api/v1/admin/plans/:id`
- **Users, Outbox, Audit & Settings**:
  - `GET /api/v1/admin/users`, `PATCH /api/v1/admin/users/:id`, `POST /api/v1/admin/users/:id/deactivate`, `POST /api/v1/admin/users/:id/activate`, `POST /api/v1/admin/users/:id/revoke-sessions`, `POST /api/v1/admin/users/:id/password-reset-link`
  - `GET /api/v1/admin/outbox`, `POST /api/v1/admin/outbox/:id/retry`, `POST /api/v1/admin/outbox/:id/cancel`
  - `GET /api/v1/admin/audit`, `GET /api/v1/admin/settings`, `PUT /api/v1/admin/settings`




## Дополнение: несколько услуг (BRON Phase 2)

Публичное создание записи и staff create/update принимают необязательный массив
`serviceIds` (1–10 различных UUID). При создании `serviceId` остаётся обязательным
и должен совпадать с первым элементом массива. Без массива сохраняется старый
контракт одной услуги. В PATCH без изменения serviceId отсутствие массива
сохраняет весь состав; изменение serviceId без массива выбирает одну новую услугу.

Public/staff availability принимают serviceIds как строку UUID через запятую,
в дополнение к основному serviceId. Мастер должен предоставлять все услуги;
ANY отбирает только таких мастеров. Все услуги принадлежат компании запроса.
Итог ограничен 720 минутами и 1 000 000 KGS; дубли/нарушения дают 400,
чужие/удалённые услуги — 404. Предоплата нового online-визита суммируется по услугам.

В staff AppointmentDto добавлен serviceIds. service.name содержит полный состав,
service.durationMin — длительность визита. Старые serviceId/service остаются для
совместимости. Итоговая price может отличаться от суммы каталожных снимков, если
сотрудник вручную назначил цену. Перенос не меняет итоговую цену и длительность.
Уже зафиксированная предоплата при редактировании состава автоматически не
пересчитывается; возвраты и частичные оплаты относятся к развитию Manual Payments.

## Дополнение: пакеты услуг, цены мастеров и статусы (BRON Core Booking)

- **Пакеты и комплексы услуг (`/api/v1/services/packages`)**: `GET` (все штатные роли компании), `POST`, `PATCH /:id`, `DELETE /:id` (`OWNER`, `MANAGER` или права услуг). Пакет включает от 2 до 10 активных услуг компании, фиксирует пакетную цену `price`, рассчитывает `catalogTotalPrice` и `totalDurationMin`. При удалении пакет помечается `deletedAt` с сохранением снимков в прошлых визитах.
- **Персональные цены и длительность мастера (`PUT /api/v1/staff/:id/services`)**: в дополнение к `serviceIds` принимает необязательный массив `serviceOverrides` (`{ serviceId, customPrice?, customDurationMin? }`). Ответ `StaffDto` включает `serviceOverrides`, а публичный `GET /api/v1/public/companies/:slug` отдаёт `packages` и массив `serviceOverrides` у каждого мастера.
- **Бронирование и доступность по пакету**: `POST /api/v1/appointments`, `POST /api/v1/public/companies/:slug/appointments`, `GET /api/v1/availability` и `GET /api/v1/public/companies/:slug/availability` принимают `packageId` (взаимоисключаем с `serviceId`/`serviceIds`). При расчёте слотов (включая `masterId=ANY`) учитывается `customDurationMin` конкретного мастера. Предоплата пакета ограничена сверху ценой пакета.
- **Статусы визита (`POST /api/v1/appointments/:id/status`)**: поддержаны переходы между `SCHEDULED`, `CONFIRMED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW` по серверной таблице переходов (`CONFIRMED` и `IN_PROGRESS` удерживают слот в `Appointment_no_overlapping_active_slots`; отмена из `IN_PROGRESS` доступна `OWNER`/`MANAGER`, восстановление из `CANCELLED` — `OWNER`). Клиентское управление по токену (`/api/v1/public/manage/:token`) разрешает перенос и отмену в статусах `SCHEDULED` и `CONFIRMED`.

## Дополнение: CRM, теги, объединение, импорт и глобальный поиск (Phase 3 CRM)

- **Теги клиентов**: `GET /api/v1/clients/tags` (все штатные роли), `POST /api/v1/clients/tags`, `PATCH /api/v1/clients/tags/:tagId`, `DELETE /api/v1/clients/tags/:tagId` (`OWNER`), `PUT /api/v1/clients/:id/tags` (`OWNER`). Имена тегов уникальны в компании без учёта регистра.
- **Сегментация и фильтры клиентов (`GET /api/v1/clients`, `POST /api/v1/clients`)**: добавлены фильтры `tagId`, `segment` (`ALL`, `NEW`, `REPEAT`, `VIP`, `AT_RISK`, `LOST`, `NO_SHOW_RISK`, `BLOCKED`), `minVisits`, `inactiveDays` и сортировка `sort=totalSpent`.
- **Объединение дубликатов (`POST /api/v1/clients/merge/preview`, `POST /api/v1/clients/merge`)**: `OWNER` выбирает `sourceClientId`, `targetClientId` и `notesStrategy` (`CONCAT`/`KEEP_TARGET`/`KEEP_SOURCE`). Preview не меняет БД; подтверждённое слияние переносит все записи и теги, помечает дубль `mergedAt` и освобождает прежний номер телефона.
- **CSV-импорт и экспорт (`POST /api/v1/clients/import/preview`, `POST /api/v1/clients/import`, `GET /api/v1/export/clients.csv`)**: импорт до 500 строк (UTF-8 BOM, `,`/`;`, авто-создание тегов, стратегии `SKIP`/`UPDATE_EMPTY`/`MERGE_TAGS`) и экспорт клиентов с защитой от CSV-инъекций формул.
- **Глобальный поиск и CRM-аналитика**: `GET /api/v1/search?q=...` возвращает клиентов, записи, услуги, пакеты и команду в пределах компании с ролевыми ограничениями (`MANAGER`/`MASTER` без PII персонала); `GET /api/v1/analytics/crm` отдаёт сводку сегментов, `repeatRate`, `retentionRate`, `topClients`, `byTag` и `revenueBasis: "COMPLETED_VISITS_ESTIMATE"`.

## Дополнение: ручной журнал платежей и приватные чеки (Phase 4 Manual Payments)

- **Журнал платежей компании (`/api/v1/payments`)** (доступно только `OWNER`, все запросы и маршруты привязаны к `companyId`):
  - `GET /api/v1/payments`: список операций (`BusinessPaymentDto`) с фильтрами `status` (`PENDING`, `CONFIRMED`, `REJECTED`, `VOIDED`), `kind` (`PAYMENT`, `PREPAYMENT`, `REFUND`), `method`, `appointmentId`, `clientId`, `from`, `to` и пагинацией; в каждой записи отдаётся `proofs` (без бинарных байт).
  - `GET /api/v1/payments/summary`: сводка за локальный период `from`/`to` (`confirmedPayments`, `confirmedRefunds`, `netConfirmedRevenue`, `pendingAmount`, `pendingCount`, `completedAppointmentsEstimate`, `byMethod`), отделяющая реальные подтверждённые поступления от оценки по завершённым визитам.
  - `POST /api/v1/payments`: создание оплаты, предоплаты или возврата (`amount`, `method`, `appointmentId?`, `clientId?`, `reference?`, `note?`, `confirmImmediately?`) через `ManualPaymentProvider`; возврат проверяет, что сумма подтверждённых возвратов не превышает подтверждённые поступления по компании (и по записи, если указан `appointmentId`).
  - `POST /api/v1/payments/:id/confirm` и `POST /api/v1/payments/:id/reject`: ручное подтверждение или отклонение ожидающей операции под строчной блокировкой `FOR UPDATE` с записью в `AuditLog`, синхронизацией `Appointment.prepaymentAmount` и постановкой уведомления в `OutboxMessage`. Повторное подтверждение/отклонение возвращает `409`.
  - `POST /api/v1/payments/:id/proofs` и `GET /api/v1/payments/:id/proofs/:proofId`: загрузка и приватная выдача чеков (JPEG/PNG/WebP/PDF до 5 МБ, перекодирование изображений в WebP, до 5 файлов на платёж, лимит 50 МБ на компанию; `Cache-Control: private, no-store`). Загрузка чека не меняет статус платежа.
- **Приватные чеки подписки (`/api/v1/billing/payments/:id/proofs*` и `/api/v1/admin/payments/:id/proofs/:proofId`)**:
  - `POST /api/v1/billing/payments/:id/proofs` (`OWNER`, доступно также в статусе подписки `LOCKED`) прикрепляет чек к ожидающей (`PENDING`) заявке подписки без автоподтверждения; `GET /api/v1/billing/payments/:id/proofs/:proofId` выдаёт файл владельцу компании с проверкой `companyId`.
  - `GET /api/v1/admin/payments` включает список `proofs`, а `GET /api/v1/admin/payments/:id/proofs/:proofId` выдаёт чеки подписки администратору платформы (`SUBSCRIPTION_PAYMENT` — к клиентским оплатам `BUSINESS_PAYMENT` доступа нет).

## Дополнение: матрица тарифов, лимиты и переход на FREE (Phase 5 SaaS Monetization)

- **Модель и ответы тарифов (`PlanDto` / `PublicPlanDto`)**: добавлены поля `description`, `maxServices`, `maxAppointmentsPerMonth`, `featureCrmAdvanced`, `featureManualPayments`, `featureMultiCompany`, `featureCustomBranding`, `isLegacy`. Публичная линейка в `GET /api/v1/public/platform` и `GET /api/v1/billing/plans` включает `FREE`, `BUSINESS`, `PRO`; архивный `START` (`isLegacy: true, isPublic: false, isActive: true`) сохранён для существующих компаний.
- **Счётчики использования в `GET /api/v1/billing`**: блок `usage` дополнительно возвращает `activeServicesCount`, `maxServices`, `isOverServicesLimit`, `monthlyAppointmentsCount`, `maxAppointmentsPerMonth`, `isOverAppointmentsLimit`, `monthlyRemindersCount`, `maxRemindersPerMonth`, `isOverRemindersLimit`.
- **Переход на бесплатный тариф (`POST /api/v1/billing/switch-free`)**: доступно `OWNER` (включая `LOCKED`), переводит подписку на `FREE` с сохранением всех услуг, клиентов, записей и платежей; при наличии активной заявки `PENDING` возвращает `409 PAYMENT_CLAIM_PENDING`.
- **Серверные ограничения тарифа (`402 PLAN_LIMIT_REACHED` / `402 FEATURE_NOT_IN_PLAN`)**:
  - квоты `maxServices` (`POST /services`, активация в `PATCH /services/:id`) и `maxAppointmentsPerMonth` (`POST /appointments`, `POST /public/companies/:slug/appointments`);
  - флаги `featureCrmAdvanced` (теги, слияние и CSV-импорт клиентов), `featureManualPayments` (создание/подтверждение/отклонение/загрузка чеков `BusinessPayment` при сохранении чтения истории), `featureMultiCompany` (`POST /auth/companies`);
  - `POST /api/v1/billing/payments` отклоняет `FREE` (`422`) и непубличные чужие тарифы (`404`); `PATCH /api/v1/admin/plans/:id` запрещает отключать `trialPlanCode` (`409`).

## Дополнение: локализация RU/KY/EN, брендинг, домены и экспорт платежей (Phase 6 Business Features)

- **Локализация `RU` / `KY` / `EN`**:
  - `Company.defaultLocale` (`PATCH /api/v1/companies/me`) и `locale` при публичной записи (`POST /api/v1/public/companies/:slug/appointments`) принимают `'RU' | 'KY' | 'EN'`.
  - Публичные шаблоны подтверждения, переноса, отмены, напоминаний (`24h`/`2h`) и инструкций по предоплате формируются на `RU`, `KY` или `EN`.
- **Брендинг и собственные домены**:
  - `GET /api/v1/companies/me`, `PATCH /api/v1/companies/me` и `GET /api/v1/public/companies/:slug` поддерживают `description` (`<= 500` симв.), `brandColor` (`#RRGGBB`), `instagramUrl` (нормализуется из `@handle` или URL) и `customDomain` (`@unique`, формат `hostname.tld`).
  - Установка непустого `customDomain` требует тарифного флага `featureCustomBranding` (`402 FEATURE_NOT_IN_PLAN` на `FREE`/`BUSINESS`, доступно на `PRO`) и проверяет глобальную уникальность (`409 CONFLICT`).
  - `GET /api/v1/public/domains/:domain` разрешает активную компанию по привязанному `customDomain` и возвращает `{ companyId, slug, name, customDomain }` (`404 NOT_FOUND`, если домен не найден или онлайн-запись отключена).
- **Экспорт журнала платежей CSV (`GET /api/v1/export/payments.csv`)**:
  - Доступно `OWNER`; принимает параметры `from` и `to` (`YYYY-MM-DD`), возвращает UTF-8 CSV с BOM и экранированием формул (`sanitizeCsvCell`) по всем платежам и возвратам компании за выбранный период.
