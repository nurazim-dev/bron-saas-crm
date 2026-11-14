# AGENTS.md — Golden Rules for Zapis.kg

Read this file, `docs/PROJECT_STATE.md`, `docs/DECISIONS.md`, and `git log --oneline -20` at the start of every phase.

## Six Non-Negotiables
1. **No code in chat**: Create and edit files exclusively via tools.
2. **Verify everything**: Never claim a check or feature works until executed and verified with exit code 0 / real HTTP requests.
3. **Phase discipline**: Execute strictly one phase at a time, deliver the phase report in Russian, and STOP.
4. **Tenant isolation**: Every tenant-owned query and mutation must be explicitly scoped by `companyId` from verified JWT (staff) or resolved company slug (public). Cross-tenant object access returns `404 NOT_FOUND`.
5. **No double-booking**: Enforce both inside `prisma.$transaction` (locking master row + half-open `[startAt, endAt)` overlap check) and via PostgreSQL `EXCLUDE USING gist` constraint.
6. **UTC everywhere**: Database (`timestamptz(3)`) and server processes (`TZ=UTC`) use UTC only. Local time (`Asia/Bishkek` default) is converted exclusively at system edges (`src/lib/datetime.ts`).

## Architecture & Conventions
- **Stack**: Node.js >= 22, npm workspaces (`backend`, `frontend`), Express 5, Prisma + PostgreSQL, Next.js App Router, Tailwind CSS, shadcn/ui, Zustand, Zod.
- **Layering (Backend)**: `routes` -> `middleware` (`validate`, `authenticate`, `require-role`, `rate-limit`) -> `controller` (thin) -> `service` (business logic, transactions, Prisma). Controllers/routes never import Prisma.
- **Express 5**: `req.query` is read-only. Store parsed Zod inputs on `req.validated`.
- **Soft Delete**: `Company`, `User`, `Service`, `Appointment` use `deletedAt`. Default `prisma` client auto-filters deleted rows; `prismaUnfiltered` is restricted to documented restore/seed/test flows.
- **API Envelope**: Success `{ "data": ..., "meta"?: ... }` (or `204`). Error `{ "error": { "code", "message", "details"?, "requestId" } }`.
- **Money & Dates**: Money is `Decimal(10,2)` serialized as string (`"1500.00"`). Instants are ISO-8601 UTC (`...Z`). Local dates are `YYYY-MM-DD`.
- **Frontend Auth**: Access token in Zustand memory only (never `localStorage`/`sessionStorage`). Single shared in-flight refresh on `401`. All UI copy in Russian (`src/lib/i18n/ru.ts`).
- **Quality Gate**: `strict: true`, `noUncheckedIndexedAccess: true`, no `any`, ESLint `--max-warnings 0`, Prettier clean. Stop all background processes before finishing a phase.
