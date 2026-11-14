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
- [ ] **Phase 10**: Hardening, E2E & Release Readiness

## Installed Versions (Phase 9)
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
  - `luxon`: 3.7.2 / `libphonenumber-js`: 1.13.16 / `lucide-react`: 1.73.0
- **Infrastructure**:
  - PostgreSQL: `postgres:17-alpine` via `docker-compose.yml` (`zapis` and `zapis_test`)

## Ports & URLs
- **Frontend (Next.js)**: `http://localhost:3000`
- **Backend (Express)**: `http://localhost:4000` (API base: `/api/v1`, proxied via Next.js `/api/:path*`)
- **PostgreSQL**: `localhost:5432` (`zapis` dev DB, `zapis_test` test DB)

## How to Run
```bash
npm install
npm run db:up        # Starts PostgreSQL container (zapis & zapis_test)
npm run db:migrate   # Applies Prisma migrations to dev DB
npm run db:seed      # Seeds Demo Barbershop data into dev DB
npm run db:reset     # Resets local dev DB (localhost-only guard) + runs migrations + seeds
npm run dev          # Starts backend (:4000) and frontend (:3000)
npm run typecheck    # Runs tsc across backend and frontend
npm run lint         # Runs ESLint (--max-warnings 0) and Prettier check
npm run test         # Runs Vitest suite in backend against zapis_test
npm run build        # Production build for backend and frontend
```

## Demo Seed Credentials (Development Only)
- **Company**: `Demo Barbershop` (slug: `demo-barbershop`, timezone: `Asia/Bishkek`, currency: `KGS`)
- **Owner**: `owner@demo.zapis.kg` / `Demo12345!`
- **Master (with login)**: `master@demo.zapis.kg` / `Demo12345!`
- **Master (without login)**: Нурлан Осмонов (`email: null`)

## Environment Variables
- `backend/.env` (from `backend/.env.example`): `NODE_ENV`, `PORT`, `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `CORS_ORIGINS`, `TRUST_PROXY`, `LOG_LEVEL`, optional rate-limit overrides (`RATE_LIMIT_*`)
- `backend/.env.test`: same keys, targeting `zapis_test` and `LOG_LEVEL=silent`
- `frontend/.env` (from `frontend/.env.example`): `NEXT_PUBLIC_APP_URL`, `BACKEND_INTERNAL_URL`

## Known Issues / Risks
- None.
