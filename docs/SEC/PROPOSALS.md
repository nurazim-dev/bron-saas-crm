# Configuration & Rule Proposals (`docs/SEC/PROPOSALS.md`)

Per session rules, `AGENTS.md` and root config files (`frontend/next.config.ts`, `.github/workflows/ci.yml`, `backend/Dockerfile`, `frontend/Dockerfile`) are not modified directly during the session. The recommended hardening changes for Low/Info items and config files are documented below:

1. **`.github/workflows/ci.yml` (`SEC-010`)**:
   - Add top-level least-privilege token permissions: `permissions: { contents: read }`.
   - Pin `actions/checkout` and `actions/setup-node` to full 40-character commit SHAs instead of mutable `@v4` tags.
   - Pin `axllent/mailpit` service image to an explicit version tag (e.g. `axllent/mailpit:v1.21.8`) instead of `:latest`.
2. **`frontend/next.config.ts` (`SEC-009` / ZAP `10037`)**:
   - Add `poweredByHeader: false` to suppress `X-Powered-By: Next.js`.
   - Add `{ source: '/manage/:path*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }` and `{ source: '/impersonate', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }`.
3. **`backend/Dockerfile` & `frontend/Dockerfile` (`SEC-011` / Trivy `DS026`)**:
   - Add `HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://localhost:4000/api/v1/health || exit 1` (and port `3000` for frontend).
   - Remove unused global `npm` inside the final production runtime stage of `node:22-alpine` (`rm -rf /usr/local/lib/node_modules/npm`) to eliminate transitive `undici` / `brace-expansion` CVEs from the container image.
4. **`scripts/gate.mjs` & `frontend/e2e/sessions.spec.ts` (Test DB Isolation)**:
   - Default `DATABASE_URL` in `scripts/gate.mjs` `--full` mode (`db-reset-seed`, `boot()`, and `e2e`) to `postgresql://zapis:zapis@localhost:5432/zapis_test?schema=public` so `npm run gate:full` never resets the local dev database `zapis` and `sessions.spec.ts` passes out of the box without passing `DATABASE_URL` manually.
