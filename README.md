# Zapis.kg

Multi-tenant SaaS CRM and online-booking platform for small service businesses in Kyrgyzstan (beauty salons, barbershops, auto-service stations).

## Monorepo Structure

- `backend/` — Express 5 + TypeScript + Prisma + PostgreSQL REST API (`/api/v1`)
- `frontend/` — Next.js (App Router) + React + Tailwind CSS + shadcn/ui web application
- `docs/` — Living project documentation (`PROJECT_STATE.md`, `DECISIONS.md`, `API.md`)

## Quick Start

1. Ensure Node.js (`>= 22`) and Docker are installed.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy environment templates if needed (`.env.example` in `backend/` and `frontend/`).
4. Start PostgreSQL:
   ```bash
   npm run db:up
   ```
5. Start development servers:
   ```bash
   npm run dev
   ```
   - Frontend: `http://localhost:3000`
   - Backend API: `http://localhost:4000/api/v1/health`

## Scripts

- `npm run dev` — Run backend (`:4000`) and frontend (`:3000`) concurrently
- `npm run build` — Build both backend and frontend
- `npm run typecheck` — TypeScript typecheck across workspaces
- `npm run lint` — ESLint (`--max-warnings 0`) + Prettier check across workspaces
- `npm run test` — Run backend test suite (Vitest + Supertest)
- `npm run db:up` / `npm run db:down` — Start/stop local PostgreSQL via Docker Compose
- `npm run db:migrate` / `npm run db:seed` / `npm run db:reset` — Database lifecycle commands (Phase 1+)
