# Zapis.kg

Multi-tenant SaaS CRM and online-booking platform for barbershops and beauty salons in Kyrgyzstan.

- **Market defaults**: Timezone `Asia/Bishkek` (UTC+6, IANA), Currency `KGS` (`сом`), Phones normalized to E.164 (`+996...`), Russian staff UI & bilingual client-facing UI (`RU` / `KY`), English codebase & API reference.
- **Core guarantees**:
  - **Strict Tenant Isolation**: Every query and mutation is scoped by `companyId` from verified JWT (staff) or resolved company slug (public). Cross-tenant access returns `404 NOT_FOUND`.
  - **Zero Double-Booking (BR-1)**: Enforced both inside `prisma.$transaction` (`SELECT ... FOR UPDATE` row lock on the master + half-open `[startAt, endAt)` overlap check) and at the PostgreSQL engine level via `EXCLUDE USING gist ("masterId" WITH =, tstzrange("startAt", "endAt", '[)') WITH &&)`.
  - **UTC Everywhere**: Database (`timestamptz(3)`) and server processes (`TZ=UTC`) operate in UTC; company-local time conversions happen exclusively at the edges (`src/lib/datetime.ts`).

---

## Architecture & Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Runtime & Monorepo** | Node.js `>= 22` (`.nvmrc`: `24`), npm workspaces (`backend`, `frontend`) |
| **Backend API** | Express 5, TypeScript (`strict: true`), Prisma 7 (`@prisma/adapter-pg`), PostgreSQL 17 (`btree_gist`), Zod, Argon2id, JWT (`httpOnly` refresh cookie + in-memory access token), Helmet, Pino |
| **Frontend Web** | Next.js 16 (App Router), React 19, Tailwind CSS 4, shadcn/ui, Zustand, React Hook Form + Zod, Luxon, `qrcode.react` |
| **Testing & CI** | Vitest + Supertest (backend integration & concurrency tests against `zapis_test`), Playwright Chromium E2E (`frontend/e2e`), GitHub Actions (`.github/workflows/ci.yml`) |

---

## Monorepo Structure

- `backend/` — Express 5 + Prisma + PostgreSQL REST API (`/api/v1`) & Outbox Worker (`dist/worker/index.js`)
  - `prisma/` — Prisma schema, migrations (including GiST exclusion & CHECK constraints), and idempotent demo seed
  - `src/modules/` — `health`, `auth`, `company`, `services`, `staff`, `time-off`, `appointments`, `availability`, `clients`, `billing`, `admin`, `notifications`, `analytics`, `onboarding`, `public`
  - `tests/` — Unit and integration test suites (`zapis_test` database)
  - `Dockerfile` — Multi-stage production container image (API & Worker)
- `frontend/` — Next.js App Router web application (PWA-enabled)
  - `src/app/` — Landing (`/`), Auth (`/login`, `/register`, `/forgot-password`, `/reset-password`), Staff CRM (`/dashboard/*`), Platform Admin (`/admin/*`), Public Booking (`/b/[slug]`, `/manage/[token]`), Legal (`/privacy`, `/terms`)
  - `e2e/` — Playwright end-to-end test suite
  - `Dockerfile` — Multi-stage production container image
- `docs/` — Living project documentation:
  - [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md) — Phase checklist, installed versions, ports, and operational summary
  - [`docs/DECISIONS.md`](docs/DECISIONS.md) — Architectural and technical decision log
  - [`docs/API.md`](docs/API.md) — Complete REST API v1 specification
  - [`docs/RUNBOOK.md`](docs/RUNBOOK.md) — Operations, backup/restore, outbox, and secret rotation runbook
  - [`docs/ADMIN.md`](docs/ADMIN.md), [`docs/BILLING.md`](docs/BILLING.md), [`docs/NOTIFICATIONS.md`](docs/NOTIFICATIONS.md), [`docs/SECURITY.md`](docs/SECURITY.md), [`docs/FEATURES.md`](docs/FEATURES.md)

---

## Quick Start (Under 5 Minutes on a Clean Machine)

1. **Prerequisites**: Node.js `>= 22` and Docker Desktop (or Docker Engine + Compose).
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Copy environment files** (if not already present):
   ```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env
   ```
4. **Start PostgreSQL (`zapis` and `zapis_test` with `btree_gist`)**:
   ```bash
   npm run db:up
   ```
5. **Apply migrations and seed demo data**:
   ```bash
   npm run db:reset
   ```
6. **Start backend (`:4000`) and frontend (`:3000`)**:
   ```bash
   npm run dev
   ```
   - **Web App & Dashboard**: `http://localhost:3000`
   - **Public Demo Booking Page**: `http://localhost:3000/b/demo-barbershop`
   - **Backend Healthcheck**: `http://localhost:4000/api/v1/health`

---

## Demo Seed Credentials (Development Only)

- **Company**: `Barbershop Ala-Too` (slug: `demo-barbershop`, timezone: `Asia/Bishkek`, currency: `KGS`)
- **Owner (`OWNER`)**: `owner@demo.zapis.kg` / `Demo12345!`
- **Master with login (`MASTER`)**: `master@demo.zapis.kg` / `Demo12345!`
- **Master without login (`MASTER`)**: Нурлан Осмонов (`email: null`)

---

## Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Start backend (`:4000`) and frontend (`:3000`) concurrently |
| `npm run build` | Production build for both `backend` and `frontend` |
| `npm run lint` | ESLint (`--max-warnings 0`) and Prettier check across workspaces |
| `npm run format` | Format all files with Prettier |
| `npm run typecheck` | TypeScript (`tsc --noEmit`) across `backend` and `frontend` |
| `npm run test` | Run backend unit & integration test suite (Vitest + Supertest on `zapis_test`) |
| `npm run test:e2e` | Run Playwright E2E browser suite against `http://localhost:3000` |
| `npm run db:up` / `npm run db:down` | Start / stop local PostgreSQL container (`docker compose`) |
| `npm run db:migrate` | Run Prisma migrations on development database |
| `npm run db:seed` | Run idempotent demo seed on development database |
| `npm run db:reset` | Reset local development database (guarded to localhost & non-production) + migrate + seed |
