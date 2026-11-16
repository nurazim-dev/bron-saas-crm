# Project State (PROJECT_STATE.md)

## Phase Checklist
- [x] **Phase 0**: Foundation & Tooling
- [x] **Phase 1**: Database & Prisma
- [x] **Phase 2**: Auth, Company & RBAC (Backend)
- [x] **Phase 3**: Services, Staff & Working Hours (Backend)
- [x] **Phase 4**: Appointments & Double-Booking Protection (Backend)
- [x] **Phase 5**: Availability Engine & Public Booking API (Backend)
- [x] **Phase 6**: Frontend Foundation & Auth UI
- [x] **Phase 7**: Dashboard: Services, Staff, Settings
- [x] **Phase 8**: Dashboard: Schedule & Appointments
- [x] **Phase 9**: Public Booking Page (Client Flow)
- [x] **Phase 10**: Hardening, E2E & Release Readiness
- [x] **Phase 11**: Audit, Baseline & Niche Narrowing (v2 Foundation, `lib/clock.ts`, BR-12 Any-Master Concurrency, `BusinessType = BARBERSHOP | BEAUTY_SALON`)
- [x] **Phase 12**: Notification Infrastructure (Outbox, Worker, Email, In-App, Audit Log)
- [x] **Phase 13**: Password Recovery (Email + Owner-Generated Reset Links)
- [x] **Phase 14**: Billing Core (Plans, Subscriptions, Trial, Grace, Locked, Manual Payments)
- [x] **Phase 15**: Admin Panel Backend (`PlatformAdmin`, 2FA TOTP, Companies, Payments, Impersonation)
- [x] **Phase 16**: Admin Panel Frontend (`/admin/**`)
- [x] **Phase 17**: Client CRM (Auto-Create, Search, Card, Notes, Blacklist, Anonymize)
- [x] **Phase 18**: Breaks & Time Off (Lunch Breaks, Vacations, Sick Leave, Staff Booking Warnings)
- [x] **Phase 19**: Client Self-Service (`/manage/[token]` View, Cancel, Reschedule)
- [x] **Phase 20**: Staff Notifications & Client Reminders (Telegram Bot, Email, WhatsApp Queue)
- [x] **Phase 21**: Light Prepayment (Manual Transfer Flow, Hold Expiry, Staff Confirm)
- [x] **Phase 22**: Analytics & CSV Export (Owner + Master Scoped)
- [x] **Phase 23**: Onboarding Checklist & Service Presets (`BARBERSHOP`, `BEAUTY_SALON`)
- [x] **Phase 24**: Kyrgyz Language (`RU`/`KY`), Legal Pages (`/privacy`, `/terms`) & Consent
- [ ] **Phase 25**: PWA (Manifest, Service Worker, Icons, Install Prompt, 360px Mobile Pass)
- [ ] **Phase 26**: Hardening, Full v2 E2E Suite, Security/Performance Audit & Final Release

## Installed Versions (Phase 10 — Release Ready)
- **Node.js**: v24.22.0 (`.nvmrc`: `24`)
- **npm**: 11.19.1
- **TypeScript**: 6.0.3
- **Backend**:
  - `express`: 5.3.0
  - `prisma` / `@prisma/client` / `@prisma/adapter-pg`: 7.10.1 (`pg`: 8.23.1)
  - `argon2`: 0.45.2 (native `argon2id`)
  - `jsonwebtoken`: 9.0.3
  - `cookie-parser`: 1.4.7
  - `express-rate-limit`: 8.7.4
  - `libphonenumber-js`: 1.13.16
  - `luxon`: 3.7.2
  - `zod`: 4.6.7
  - `pino`: 10.4.0 / `pino-http`: 11.0.0 / `pino-pretty`: 13.2.0
  - `helmet`: 8.3.0
  - `cors`: 2.8.6
  - `nodemailer`: 10.5.0 (`@types/nodemailer`: 8.0.2)
  - `otplib`: 13.6.0
  - `tsx`: 4.23.15
  - `vitest`: 5.1.0 / `supertest`: 7.3.2
  - `eslint`: 9.39.5 / `typescript-eslint`: 8.72.2 / `prettier`: 3.10.1
- **Frontend**:
  - `next`: 16.4.6
  - `react` / `react-dom`: 19.3.1
  - `tailwindcss` / `@tailwindcss/turbopack`: 4.3.5
  - `shadcn`: 4.23.0 (`button`, `input`, `label`, `card`, `sonner`, `badge`, `skeleton`)
  - `zustand`: 5.1.0
  - `axios`: 1.21.1
  - `react-hook-form`: 7.92.0 / `@hookform/resolvers`: 7.0.6 / `zod`: 4.6.7
  - `qrcode.react`: 4.2.0
  - `luxon`: 3.7.2 / `libphonenumber-js`: 1.13.16 / `lucide-react`: 1.73.0
  - `@playwright/test`: 1.65.1 (Chromium E2E suite)
- **Infrastructure & CI**:
  - PostgreSQL: `postgres:17-alpine` via `docker-compose.yml` (`zapis` and `zapis_test`)
  - Mailpit: `axllent/mailpit:latest` via `docker-compose.yml` (SMTP `:1025`, Web UI & API `:8025`)
  - Containers: `backend/Dockerfile`, `frontend/Dockerfile` (multi-stage `node:24-alpine`, non-root `node` user)
  - CI: `.github/workflows/ci.yml`

## Ports & URLs
- **Frontend (Next.js)**: `http://localhost:3000`
- **Backend (Express)**: `http://localhost:4000` (API base: `/api/v1`, proxied via Next.js `/api/:path*`)
- **PostgreSQL**: `localhost:5432` (`zapis` dev DB, `zapis_test` test DB)
- **Mailpit UI / HTTP API**: `http://localhost:8025` (SMTP on `localhost:1025`)

## How to Run
```bash
npm install
npm run db:up        # Starts PostgreSQL and Mailpit containers
npm run db:migrate   # Applies Prisma migrations to dev DB
npm run db:seed      # Seeds Demo Barbershop data into dev DB
npm run db:reset     # Resets local dev DB (localhost-only guard) + runs migrations + seeds
npm run dev          # Starts backend (:4000) and frontend (:3000)
npm run worker       # Starts standalone background outbox worker
npm run typecheck    # Runs tsc across backend and frontend
npm run lint         # Runs ESLint (--max-warnings 0) and Prettier check
npm run test         # Runs Vitest suite in backend against zapis_test
npm run build        # Production build for backend and frontend
npm run test:e2e     # Runs Playwright Chromium E2E suite
```

## Demo Seed Credentials (Development Only)
- **Company**: `Barbershop Ala-Too` (slug: `demo-barbershop`, timezone: `Asia/Bishkek`, currency: `KGS`)
- **Owner**: `owner@demo.zapis.kg` / `Demo12345!`
- **Master (with login)**: `master@demo.zapis.kg` / `Demo12345!`
- **Master (without login)**: Нурлан Осмонов (`email: null`)

## Environment Variables
- `backend/.env` (from `backend/.env.example`): `NODE_ENV`, `PORT`, `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `CORS_ORIGINS`, `TRUST_PROXY`, `LOG_LEVEL`, `APP_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `CLIENT_MESSAGE_PROVIDER`, `WORKER_ENABLED`, `WORKER_INTERVAL_MS`, optional rate-limit overrides (`RATE_LIMIT_*`)
- `backend/.env.test`: same keys, targeting `zapis_test` and `LOG_LEVEL=silent`
- `frontend/.env` (from `frontend/.env.example`): `NEXT_PUBLIC_APP_URL`, `BACKEND_INTERNAL_URL`

## Known Issues / Risks
- None. Phases 0–19 are complete and verified. Ready for Phase 20.
