# Autopilot Control (Phases 17–26)

- **Mode**: `COMPLETE`
- **Branch**: `develop`
- **Current Phase**: `26`
- **Next Action**: None — all phases 17–26 complete.
- **Baseline Test Counts**:
  - `backend_tests`: `145`
  - `e2e_scenarios`: `14`

## Preflight Answers (User Confirmed `OK` + Item 1 = Bot Ready at End, Item 2 = MANUAL)
1. **Telegram Bot**: user has a bot and will fill `TELEGRAM_BOT_TOKEN` & `TELEGRAM_BOT_USERNAME` into `backend/.env` at the end (build full provider + webhook/polling + fake API tests; real Bot API marked `UNVERIFIED` until user enters credentials).
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
| 17 | Client CRM | `COMPLETE` | `phase-17` | 2026-11-16 |
| 18 | Breaks & Time Off | `COMPLETE` | `phase-18` | 2026-11-16 |
| 19 | Client Self-Service | `COMPLETE` | `phase-19` | 2026-11-16 |
| 20 | Staff Notifications & Client Reminders | `COMPLETE_WITH_NOTES` | `phase-20` | 2026-11-16 |
| 21 | Light Prepayment | `COMPLETE` | `phase-21` | 2026-11-16 |
| 22 | Analytics & CSV Export | `COMPLETE` | `phase-22` | 2026-11-16 |
| 23 | Onboarding & Presets | `COMPLETE` | `phase-23` | 2026-11-16 |
| 24 | Kyrgyz Language, Legal Pages & Consent | `COMPLETE_WITH_NOTES` | `phase-24` | 2026-11-16 |
| 25 | PWA | `COMPLETE` | `phase-25` | 2026-11-16 |
| 26 | Hardening, E2E & Release Readiness | `COMPLETE` | `phase-26` | 2026-11-16 |

## Links
- [BLOCKERS.md](./BLOCKERS.md)
- [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md)
- [Reports directory](./reports/)
