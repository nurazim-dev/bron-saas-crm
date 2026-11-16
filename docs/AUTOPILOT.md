# Autopilot Control (Phases 17–26)

- **Mode**: `RUNNING`
- **Branch**: `develop`
- **Current Phase**: `17`
- **Next Action**: Implement Phase 17 (Client CRM backend, frontend, tests, E2E) and run the Phase 17 gate.
- **Baseline Test Counts**:
  - `backend_tests`: `113`
  - `e2e_scenarios`: `5`

## Preflight Answers (User Confirmed `OK` + Item 2 = MANUAL)
1. **Telegram Bot**: none (build provider + fake API tests; real Bot API marked `UNVERIFIED`).
2. **SMS/WhatsApp Gateway (Phase 20)**: none — keep `MANUAL` mode + `LogProvider`, `AUTO` hidden in prod.
3. **Downloads (`npm`, Playwright Chromium, Docker)**: allowed.
4. **Local dev/test DB & Docker destructive ops**: allowed (`db:reset`, `truncate`, restart).
5. **Git**: 1 commit per phase + local tags `autopilot/phase-N-done` on `develop`, never push.
6. **Earlier-phase bugfixes**: allowed when blocking or violating spec (logged in `DECISIONS.md`).
7. **Plans/prices/limits**: keep illustrative defaults (editable in `/admin`).
8. **Kyrgyz translations & legal drafts (Phase 24)**: write with mandatory human review notice.
9. **Phase 26 extras**: 200-req local load test, `npm audit fix` (non-breaking), `pg_dump`/restore into temp DB allowed.
10. **Splitting oversized phases**: allowed (`Na`/`Nb` back to back).
11. **Generated binary assets (PWA icons)**: commit allowed.
12. **Command classes**: `npm`, `npx`, `node`, `docker`, `git`, `curl`, `playwright`, `psql`/`pg_dump`, kill own started processes allowed.

## Phase Table
| Phase | Name | Status | Commit | Date |
| :--- | :--- | :--- | :--- | :--- |
| 17 | Client CRM | `IN_PROGRESS` | — | — |
| 18 | Breaks & Time Off | `PENDING` | — | — |
| 19 | Client Self-Service | `PENDING` | — | — |
| 20 | Staff Notifications & Client Reminders | `PENDING` | — | — |
| 21 | Light Prepayment | `PENDING` | — | — |
| 22 | Analytics & CSV Export | `PENDING` | — | — |
| 23 | Onboarding & Presets | `PENDING` | — | — |
| 24 | Kyrgyz Language, Legal Pages & Consent | `PENDING` | — | — |
| 25 | PWA | `PENDING` | — | — |
| 26 | Hardening, E2E & Release Readiness | `PENDING` | — | — |

## Links
- [BLOCKERS.md](./BLOCKERS.md)
- [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md)
- [Reports directory](./reports/)
