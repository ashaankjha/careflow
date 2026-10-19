# Orchestration report — MVP gaps and hardening

**Status: synthetic sandbox only. Not HIPAA-compliant and not approved for real patient data** (see `security-production-gates.md`).

This round closed the MVP backlog listed in `agent-decisions.md` and the risk registry. Eight workstreams ran in child sessions (six in the main round, two in a final hardening round), each on its own `claude/careflow-ws-*` branch with assigned files and migration numbers. Each branch was merged in turn into `claude/careflow-ai-mvp-gyrzv4` with merge commits (no history rewrites). The full gate set was re-run after every merge. PRD §20 stretch items were not touched.

## Gate results (integrated branch, starting from dropped databases and a dropped app role)

| Gate | Before | After |
|---|---|---|
| `pnpm db:migrate && pnpm db:reset` | ✓ | ✓ (5 migrations: 0000–0004) |
| `pnpm lint`, `pnpm typecheck` | ✓ | ✓ |
| `pnpm test` (Vitest) | 99 | **266** (core 125, db 99, web 27, connectors 9, jobs 6) |
| `pnpm test:e2e` (Playwright, production build) | 11 | **26** (includes 9 axe specs covering ~17 screens/states, nonce-CSP and CSP-report checks) |
| GitHub Actions CI | none | ✓ green on this branch |

The seeded acceptance chain is unchanged and covered by E2E workflows 3, 5 and 7, and it is now identical at any time of day (see the seed fix below):
- Meridian is accepted by West, not North.
- Editing West staff hours makes West a potential fit.
- Generating missions adds West M2/M6/M7; the seed alone yields M1 North, M3 North and M4 South.
- Resetting the demo restores the exact seed.

## What each workstream delivered

| Workstream (branch) | Delivered | Main tests |
|---|---|---|
| **Tenancy** (`ws-tenancy`) — R1, R2 | <ul><li>Migration `0002_app_role_rls` creates the non-owner `careflow_app` role, idempotently. It has no update/delete on the audit tables. Default privileges cover tables created by later migrations.</li><li>Row-level security is FORCEd on every tenant table, plus `organizations`, `users` and `sessions`.</li><li>Sign-in happens before the tenant is known, so it goes through three SECURITY DEFINER functions: user lookup, session resolution, session revocation.</li><li>Every API request and server-component data load runs in one transaction that sets `app.current_org` for that transaction only (`route()` / `withOrg()`).</li><li>Migrations, seed and reset use the owner `DATABASE_URL`.</li><li>The rate limiter is now a shared Postgres fixed-window counter (`rate_limit_buckets`).</li></ul> | `app-role.test.ts`: cross-tenant reads and writes, fail-closed when no org is set, no leak through pooled connections, and an "every tenant table has forced RLS" check. `rate-limit.test.ts`: two pools hitting the limiter concurrently. |
| **Capacity** (`ws-capacity`) — PRD §8, R8 | <ul><li>Migration `0003`. `reserveHold` / `releaseHold` lock the center row (`FOR UPDATE`) in one transaction, so concurrent reservations cannot exceed verified hours or the weekly new-start limit.</li><li>Holds carry `expires_at`. Expiry is lazy at read time, plus an `expire-holds` job.</li><li>New API routes, audit entries and inquiry events. The inquiry drawer has reserve/release buttons, and its copy says a hold is "not an appointment".</li><li>Capacity sheet versions with valid_from/valid_to, so capacity-fit metrics for past cohorts use capacity as of inquiry time.</li></ul> | Concurrency test with parallel connections; capacity-history integration tests; E2E workflow 8; axe scan of the reserved-hold drawer (added during integration). |
| **Analytics** (`ws-analytics`) — PRD §11, clustering | <ul><li>Equity audit: access rates by payer category versus overall, small-cell suppression at the tenant `minCellSize`, and complementary suppression.</li><li>The panel states "equity audit only — never used for scoring, ranking, matching or exclusion".</li><li>`GET /api/v1/equity` uses a new `equity:read` permission. A test asserts that the matcher does not import equity code.</li><li>Partner and site-week experiments use a cluster-robust ratio-estimator interval and report the number of clusters. Below 10 clusters per arm the result stays "insufficient evidence".</li><li>Also fixed a site-week randomization bug.</li></ul> | Core known-answer and suppression tests; db integration test; route RBAC test; E2E workflow 9; axe scan of the equity tab. |
| **Quality** (`ws-quality`) — CI, a11y, R3 | <ul><li>`.github/workflows/ci.yml`: Postgres 16 service, migrate, seed, lint, typecheck, test, E2E, and the Playwright report uploaded on failure.</li><li>`@axe-core/playwright` scans every screen, with violations fixed at the source and no rule exceptions.</li><li>Per-request nonce CSP in middleware: `'strict-dynamic'`, no `'unsafe-inline'` scripts.</li><li>Root-caused the flaky overview filter test, which was also flaky on the base branch. The `(app)/loading.tsx` boundary hung same-page search-param navigations in production builds, so the file was removed.</li></ul> | `a11y.spec.ts`, CSP E2E, `middleware.test.ts`. |
| **Kanban** (`ws-kanban`, optional) | Native HTML5 drag-and-drop between stage columns, plus a keyboard and touch "Move to…" menu. Both call the existing transition API. Illegal target columns are disabled, server errors roll the card back, and moves that need a reason open the drawer. Viewers can neither drag nor move. | `legalMoves` unit tests; E2E workflow 10; axe scan of the board. |
| **Locale** (`ws-locale`, optional) | `es-US` deterministic draft templates. English output is unchanged (snapshot test). The claim validator now has Spanish rules and a HIPAA-claim rule in both languages. Pages set `lang` correctly, and the UI says the Spanish text is machine-authored and needs human translator review before any real use. | Core and db tests; E2E workflow 11; axe scans of the Spanish editor, print page and export. |
| **Jobs role + lockout** (`ws-jobsrole`, final round) — R1/R2 residuals | <ul><li>Migration `0004_jobs_role_lockout`. The jobs CLI runs only as `careflow_app`, once per organization inside a `withOrg` transaction. Organizations come from `careflow_job_org_ids()` (ids only), or `--org`. Job audit rows have no actor.</li><li>Per-account sign-in lockout: 5 failures in 15 min lock that email for 15 min, whatever the IP. It is keyed by a SHA-256 of the email, so unknown emails behave identically, and the 429 response is the same generic message. The app role reaches `login_attempts` only through SECURITY DEFINER functions.</li></ul> | `jobs-app-role.test.ts` (6), `login-lockout.test.ts` (8), `login-lockout-route.test.ts` (2). |
| **Polish** (`ws-polish`, final round) — R3 residual, locale | <ul><li>CSP `report-uri` / `report-to` point only at a same-origin `POST /api/v1/csp-report`. It has an 8 KB cap and a per-IP limit, and logs a sanitized one-line summary (directive, blocked origin, path without query string).</li><li>EN/ES language badges on drafts in the missions list.</li></ul> | `csp-report.test.ts`; E2E asserts the report directives and zero reports while navigating every screen; workflow 11 checks the badge. |

## Integration fixes made by the orchestrator

- Reconciled the migration journal across workstreams (0002 and 0003 kept in timestamp order).
- Repaired merge splices in the E2E specs (missing test closers), renumbered workflows 9–11, and renamed screenshots that collided.
- Pointed the equity route test at the least-privilege app-role pool. It returned 401 under the new tenancy model.
- Extended axe coverage to the equity tab and the reserved-hold drawer.
- Merged the documentation conflicts so that every workstream's caveats were kept.
- **Fixed a pre-existing seed bug found during final verification.** The simulator stops drawing random numbers once an event would fall after "now", so a reset at different times of day produced a different story. Between roughly 02:00 and 04:00 UTC the seed grew an extra **M6 South** mission, breaking the "exactly M1 North, M3 North, M4 South" guarantee. The tests never caught it because they pin 18:00 UTC.
  - The fix simulates at the latest 18:00 UTC at or before now and shifts every simulated timestamp forward to now. The story is identical at any hour and still ends at now. Pinned 18:00 anchors are byte-identical to before.
  - Mission generation also duplicated still-unreviewed proposals once a new reporting week began. Those are now refreshed and re-keyed instead.
  - Covered by `seed-stability.test.ts`.

## Deferred / remaining limitations (and why)

- **CI runs green on GitHub Actions** for this branch (runs on pushes of `97caf6f` and `f8557e7` succeeded: migrate, seed, lint, typecheck, test and E2E against a Postgres 16 service). **Docker is not verified:** `docker-compose.yml` was reviewed by reading only, because there is no Docker daemon here.
- **Jobs CLI** now runs as the app role (done). The job host still holds the app-role secret, and `careflow_job_org_ids()` lets that role list organization ids.
- **The demo-reset button uses the owner connection.** It purges both demo tenants. It can be turned off with `DEMO_RESET_ENABLED=false`, which is required before any shared deployment.
- **Rate limiter is not a WAF.** The sign-in IP key comes from `X-Forwarded-For` and can be spoofed without a trusted proxy. Per-account lockout is built, but:
  - anyone who knows an email can lock it for the cool-down, and there is no unlock flow;
  - the email hash is unsalted;
  - lockouts survive `db:reset` until they expire.
- **`style-src 'unsafe-inline'` remains.** React, Radix and Recharts set inline style attributes. CSP violation reports reach the server log only; there is no aggregation or alerting.
- **Capacity limits:**
  - History versions only the capacity sheet; payer participation and site profile are applied as currently recorded.
  - Holds subtract from the weekly total, not from specific time windows.
  - Holds are never linked to scheduling.
- **Experiment and equity limits:**
  - Cluster intervals are a large-sample approximation with no small-sample corrections.
  - The seeded partner experiment, with nine partners, can never leave "insufficient evidence".
  - Equity suppression works on one dimension and does not stop disclosure by differencing across filters.
- **No route-level loading skeleton.** It was removed deliberately and should not be reintroduced.
- **Dark mode is not implemented.** It is not cheap here: the charts, map and logo use hard-coded colours.
- **Accessibility:** axe automated checks only, light scheme and desktop viewport. This is not a WCAG conformance claim.
- **Spanish templates** are machine-authored and unreviewed. The validator's Spanish rules are a keyword list.
- **Kanban:** native drag does not work with touch on most mobile browsers; the menu is the touch path. The board has no Started or exit columns.
- **Still not built:** PRD §20 items, live NPPES/ACS automation, `page_session` randomization and consent records. These are out of MVP scope.
