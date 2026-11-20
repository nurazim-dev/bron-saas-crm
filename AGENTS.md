# AGENTS.md — Golden Rules for Zapis.kg (v2)

Read this file, `docs/PROJECT_STATE.md`, `docs/DECISIONS.md`, and `git log --oneline -20` at the start of every phase.

## Eleven Non-Negotiables
1. **No code in chat**: Create and edit files exclusively via tools.
2. **Verify everything**: Never claim a check or feature works until executed and verified with exit code 0 / real HTTP requests.
3. **Phase discipline**: Execute strictly ONE phase at a time, deliver the phase report in Russian (`<= 60` lines), and STOP.
4. **Tenant isolation**: Every tenant-owned query and mutation must be explicitly scoped by `companyId` from verified JWT (staff) or resolved company slug/token (public). Cross-tenant object access returns `404 NOT_FOUND`.
5. **No double-booking**: Enforce both inside `prisma.$transaction` (locking master row + half-open `[startAt, endAt)` overlap check) and via PostgreSQL `EXCLUDE USING gist` constraint (`Appointment_no_overlapping_active_slots`). Any-available-master booking (**BR-12**) locks one candidate master at a time and falls back deterministically across remaining candidates.
6. **UTC & Clock everywhere**: Database (`timestamptz(3)`) and server processes (`TZ=UTC`) use UTC only. Local time (`Asia/Bishkek` default) is converted exclusively at system edges (`src/lib/datetime.ts`). Backend business logic reads current time exclusively through `backend/src/lib/clock.ts` (`now()`, `FakeClock`); ESLint bans `new Date()`, `Date.now()`, `DateTime.now()`, and `DateTime.local()` outside `lib/clock.ts`.
7. **Platform-admin isolation**: Separate `PlatformAdmin` table, separate tokens (`aud: "zapis-admin"`) and secrets, code only in `modules/admin`. Impersonation is read-only (`403 IMPERSONATION_READ_ONLY` on non-GET) and audited.
8. **Transactional outbox notifications**: All external notifications (`EMAIL`, `TELEGRAM`, `WHATSAPP_AUTO`, `SMS`) are queued asynchronously through `OutboxMessage` inside the business transaction. No user request ever waits for, or fails because of, an external provider.
9. **Billing never deletes data**: A lapsed subscription (`LOCKED`) means read-only mode (`402 SUBSCRIPTION_LOCKED` on staff writes), never data loss.
10. **High-entropy security tokens**: Password reset tokens, manage tokens, impersonation codes, and TOTP secrets are high-entropy, single-use where stated, hashed (`SHA-256`) or encrypted (`AES-256-GCM`) at rest where stated, never logged, and never put in error messages.
11. **Niche focus**: The product serves ONLY barbershops (`BARBERSHOP`) and beauty salons (`BEAUTY_SALON`). No auto-service (`СТО` / `AUTO_SERVICE` / `OTHER`) remnants anywhere.

## Architecture & Conventions
- **Stack**: Node.js >= 22, npm workspaces (`backend`, `frontend`), Express 5, Prisma 7 + PostgreSQL 17, Next.js App Router, Tailwind CSS, shadcn/ui, Zustand, Zod.
- **Layering (Backend)**: `routes` -> `middleware` (`validate`, `authenticate`, `require-role`, `rate-limit`) -> `controller` (thin) -> `service` (business logic, transactions, Prisma). Controllers/routes never import Prisma.
- **Express 5**: `req.query` is read-only. Store parsed Zod inputs on `req.validated`.
- **Soft Delete**: `Company`, `User`, `Service`, `Appointment` use `deletedAt`. Default `prisma` client auto-filters deleted rows; `prismaUnfiltered` is restricted to documented restore/seed/test/admin flows. `Client` is never deleted (erasure = anonymization).
- **API Envelope**: Success `{ "data": ..., "meta"?: ... }` (or `204`). Error `{ "error": { "code", "message", "details"?, "requestId" } }`.
- **Money & Dates**: Money is `Decimal(10,2)` serialized as string (`"1500.00"`). Instants are ISO-8601 UTC (`...Z`). Local dates are `YYYY-MM-DD`.
- **Frontend Auth**: Access token in Zustand memory only (never `localStorage`/`sessionStorage`). Single shared in-flight refresh on `401`. Dashboard/admin UI copy in Russian; client-facing UI in Russian and Kyrgyz.
- **Quality Gate**: `strict: true`, `noUncheckedIndexedAccess: true`, no `any`, ESLint `--max-warnings 0`, Prettier clean. Stop all background processes before finishing a phase.
