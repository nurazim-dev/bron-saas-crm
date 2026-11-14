# Project State (PROJECT_STATE.md)

## Phase Checklist
- [x] **Phase 0**: Foundation & Tooling
- [ ] **Phase 1**: Database & Prisma
- [ ] **Phase 2**: Auth, Company & RBAC (Backend)
- [ ] **Phase 3**: Services, Staff & Working Hours (Backend)
- [ ] **Phase 4**: Appointments & Double-Booking Protection (Backend)
- [ ] **Phase 5**: Availability Engine & Public Booking API (Backend)
- [ ] **Phase 6**: Frontend Foundation & Auth UI
- [ ] **Phase 7**: Dashboard: Services, Staff, Settings
- [ ] **Phase 8**: Dashboard: Schedule & Appointments
- [ ] **Phase 9**: Public Booking Page (Client Flow)
- [ ] **Phase 10**: Hardening, E2E & Release Readiness

## Installed Versions (Phase 0)
- **Node.js**: v24.22.0 (`.nvmrc`: `24`)
- **npm**: 11.19.1
- **TypeScript**: 6.0.3
- **Backend**:
  - `express`: 5.3.0
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
  - `shadcn`: 4.23.0 (`button`, `input`, `label`, `card`, `sonner`)
  - `lucide-react`: installed via shadcn
- **Infrastructure**:
  - PostgreSQL: `postgres:17-alpine` via `docker-compose.yml` (creates `zapis` and `zapis_test`)

## Ports & URLs
- **Frontend (Next.js)**: `http://localhost:3000`
- **Backend (Express)**: `http://localhost:4000` (API base: `/api/v1`, proxied via Next.js `/api/:path*`)
- **PostgreSQL**: `localhost:5432` (`zapis` dev DB, `zapis_test` test DB)

## How to Run
```bash
npm install
npm run db:up        # Starts PostgreSQL container (requires Docker daemon running)
npm run dev          # Starts backend (:4000) and frontend (:3000)
npm run typecheck    # Runs tsc across backend and frontend
npm run lint         # Runs ESLint (--max-warnings 0) and Prettier check
npm run test         # Runs Vitest suite in backend
npm run build        # Production build for backend and frontend
```

## Environment Variables
- `backend/.env` (from `backend/.env.example`): `NODE_ENV`, `PORT`, `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `CORS_ORIGINS`, `TRUST_PROXY`, `LOG_LEVEL`
- `backend/.env.test`: same keys, targeting `zapis_test` and `LOG_LEVEL=silent`
- `frontend/.env` (from `frontend/.env.example`): `NEXT_PUBLIC_APP_URL`, `BACKEND_INTERNAL_URL`

## Seed Credentials
- To be added in Phase 1 (`owner@demo.zapis.kg` / `master@demo.zapis.kg` / `Demo12345!`).

## Known Issues / Risks
- Docker Desktop daemon must be running before starting **Phase 1** (`npm run db:up`).
