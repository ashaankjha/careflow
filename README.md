# CareFlow AI — capacity-aware growth OS for ABA providers

> **⚠️ SYNTHETIC DEMONSTRATION ONLY.** Every organization, site, payer, partner, person and place in this repository is fictional. The app refuses non-synthetic inquiry rows at the database level, never sends messages, never publishes content, and is **not** a HIPAA-compliant deployment. See [`docs/security-production-gates.md`](docs/security-production-gates.md) before any real pilot.

CareFlow connects intake funnel events, verified operational capacity, local market signals, referral outreach and growth experiments into one closed loop whose north star is **more families who successfully begin care** — not more leads. Marketing is only ever recommended where **verified, unsaturated capacity** exists; everything outward-facing waits for human approval.

![Overview](docs/screenshots/01-overview.png)

## What works (MVP, end-to-end)

| Capability | Where | Highlights |
|---|---|---|
| Multi-location growth dashboard | **Overview** | KPIs computed live from the immutable event log (care starts, cohort start rate, first-response, inquiry-to-start, capacity-fit as of inquiry time, stalls) — each with definition, numerator and denominator; site demand-vs-capacity matrix; trend; stage drop-off; attribution with an explicit *unattributed* bucket; provenance |
| Intake funnel | **Intake Funnel** | Filterable table (TanStack) + Kanban (drag a card or use its keyboard-accessible “Move to…” menu; only legal stage-machine moves accept a drop, reason-required moves open the drawer, errors roll back), owner queues, stall flags, add simulated inquiry (PII guard), CSV preview/idempotent import, drawer with immutable timeline, quick stage transitions, outreach logging, site selection, match snapshots, aggregate-only CSV export |
| Capacity-aware matching | **Capacity & Matching** | Ops editors for payer status and staff windows (optimistic locking, attest-as-verified, every save versioned for as-of metrics), explainable hard gates (geography, payer, mode, age policy, RBT schedule, BCBA supervision, weekly start limit), soft score breakdown, `verification_needed` / `no_feasible_match` states, “Test a match” |
| Capacity reservation holds | **Intake drawer** | Reserve a verified potential fit as a capacity hold in a row-locked transaction (concurrent reservations can never exceed verified hours or the weekly new-start limit), release, automatic expiry; holds are explicitly **not appointments** |
| Geographic market intelligence | **Market Map** | Offline hex-tile choropleth (fictional geography), five layers, transparent opportunity heuristic with missing-component ranges, small-cell suppression, provenance panel, admin refresh with ACS connector and fixture fallback |
| Evidence-based growth missions | **Growth Missions** | Deterministic rules M1–M7 with saved evidence, dedupe per reporting week (unreviewed proposals are refreshed, not duplicated), capacity-gated demand rules, ops sign-off gates, approve/reject/status |
| Referral drafting & experiments | **Missions → drafts**, **Experiments**, **Referral Network** | Template drafts from verified records + claim validator, edit/re-validate/approve, English (`en-US`) or Spanish (`es-US`) drafts — Spanish templates are machine-authored and must be reviewed by a qualified human translator before any real use, local preview/print only (send disabled), partner codes + QR, partner- and site-week-randomized experiments with persisted HMAC assignments, Wilson/Newcombe intervals (individual) or cluster-robust intervals with clusters per arm (partner/site-week) only when eligible, “insufficient evidence” otherwise; **Equity audit** tab with aggregate payer-group access rates and small-cell suppression (never used for scoring, ranking, matching or exclusion) |
| Synthetic demo that ties it together | seed + **Settings → Reset** | ~150 inquiries / ~900 events over 90 days across North (capacity bottleneck), West (unverified headroom) and South (benefits stalls); one-click reset to the exact seed state |

### The acceptance demo (≈3 minutes)

1. Sign in as **Sam Patel (Ops)** → *Capacity & Matching* → **Load acceptance scenario** (Meridian Medicaid plan, ZCTA 00106, Mon/Wed/Thu 2–6 pm, 6 h/wk).
   North: ❌ *payer — staff recorded this site as not accepting this payer*. West: ✅ payer, ❓ *0.0 verified + 12.0 unverified RBT h/wk pending ops verification*.
2. **Edit capacity** on West → change Monday 1–6 pm RBT hours 5 → 6 → **Save & attest verified**. West flips to **Potential fit** with a score breakdown and a fresh evidence timestamp. Overview now shows West at 46 verified h/wk.
3. *Growth Missions* → **Generate from current data** → a new **M2 West: connect families to verified open capacity** appears (plus M6/M7), each citing saved metrics. North never receives a demand mission.
4. **Approve** (ops-gated) → **Referral packet** → validator confirms every claim traces to verified records → **Approve** → **Printable packet**. *Send* stays disabled.
5. **Connect experiment** → partner-randomized, persisted HMAC assignments → results show **Insufficient evidence** with caveats (simulated, censored, too few partner clusters per arm).
6. *Settings* → **Reset demo to seed state** (or `pnpm db:reset`).

All of the above is automated in [`apps/web/e2e/workflows.spec.ts`](apps/web/e2e/workflows.spec.ts).

## Quick start

Requirements: Node ≥ 20, pnpm 10, PostgreSQL 16 (Docker Compose provided). **No API keys or internet access are needed.**

```bash
pnpm install
cp .env.example .env          # synthetic defaults, no real credentials
docker compose up -d          # or use any local PostgreSQL 16; create databases careflow + careflow_test
pnpm db:migrate               # as the owner role; also creates/updates the app role `careflow_app`
pnpm db:seed                  # deterministic synthetic fixture
pnpm dev                      # http://localhost:3000 — serves requests as `careflow_app` (RLS enforced)
```

**Two database roles.** `DATABASE_URL` is the owner/migration role (must be SUPERUSER or BYPASSRLS — the Compose `postgres` user is): it runs migrations, `db:seed`, `db:reset` and the demo-reset purge. The web app and the jobs CLI serve every request as the least-privilege `careflow_app` role from `APP_DATABASE_URL`, inside a transaction that sets `app.current_org`; row-level security is FORCEd on every tenant table. `pnpm db:migrate` creates the role idempotently (NOLOGIN in the migration, no secret) and then sets its LOGIN password from `APP_DATABASE_URL` — the `.env.example` password is **dev-only**. Using an existing PostgreSQL instead of Compose? The migration role also needs `CREATEROLE` (or create `careflow_app` yourself and give `APP_DATABASE_URL` a different user to skip the password sync).

### Demo credentials (password for all: `demo-pass-2026`)

| Persona | Email | Role |
|---|---|---|
| Avery Chen | `admin@harbor.demo` | System administrator (everything incl. reset & market refresh) |
| Riley Okafor | `growth@harbor.demo` | Growth director (missions, drafts, experiments, partners) |
| Sam Patel | `ops@harbor.demo` | Operations director (capacity, payers, ops-gated approvals, audit) |
| Jordan Lee | `intake@harbor.demo` | Intake manager (inquiries, transitions, import, matching) |
| Casey Brooks | `viewer@harbor.demo` | Location manager (read-only) |
| Drew Lindqvist | `admin@lakeside.demo` | Second tenant, used to prove isolation |

The login page has one-click persona buttons.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Next.js dev server on :3000 |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm db:migrate` | Apply typed Drizzle migrations (+ hand-written integrity/RLS migration) |
| `pnpm db:seed` / `pnpm db:reset` | Seed / **reset everything to the exact seed state** (one command) |
| `pnpm demo:reset` | Migrate + reset in one go |
| `pnpm jobs <name> [--org <uuid>]` | Run a cron-compatible job manually: `compute-daily-metrics`, `generate-missions`, `expire-holds`, `refresh-market`. Runs as the least-privilege app role (`APP_DATABASE_URL`, not the owner), once per organization in its own RLS-scoped transaction; all organizations by default, or only those listed with `--org` (comma-separated) |
| `pnpm lint` · `pnpm typecheck` | ESLint (flat config) · strict TypeScript, all packages |
| `pnpm test` | Vitest: core domain, connectors, DB integration (uses `TEST_DATABASE_URL`), API wrapper |
| `pnpm test:e2e` | Playwright: production build, 7 demo workflows + capacity-hold reserve/release + equity audit + Kanban drag/drop + Spanish packet generate/approve + security (RBAC, nonce CSP) + keyboard + mobile + axe WCAG 2.1 A/AA scan of every screen; writes `docs/screenshots/` |

`pnpm test` creates/migrates/reseeds `careflow_test` (it refuses any URL without “test” in it). `pnpm test:e2e` reseeds the main database first.

**CI:** `.github/workflows/ci.yml` runs on every push and pull request: PostgreSQL 16 service, `pnpm install --frozen-lockfile`, migrate + seed, lint, typecheck, `pnpm test`, then `pnpm test:e2e` (Playwright report uploaded as an artifact on failure). No secrets or API keys are needed.

**Accessibility:** `apps/web/e2e/a11y.spec.ts` runs axe-core (WCAG 2.1 A/AA tags) on every screen with no rule exceptions. That is an automated check, not a full WCAG audit.

## Architecture

```
apps/web            Next.js 15 App Router · React 19 · Tailwind · Radix · TanStack Table · Recharts
  app/(app)/*       server-rendered screens (session + RBAC checked server-side)
  app/api/v1/*      typed route handlers: auth, CSRF origin check, rate limit, Zod, error envelope
packages/core       pure domain: stages, Zod contracts, RBAC matrix, matcher, mission rules, stats, content validator, CSV
packages/db         Drizzle schema + migrations, seed, tenant-scoped services (metrics as SQL), auth sessions
packages/connectors ACS adapter, NPPES fixture notes, optional LLM adapter (allowlisted payload), disabled delivery/intake
packages/jobs       cron-compatible jobs run via CLI
```

Details, diagrams and the rule trace: [`docs/architecture.md`](docs/architecture.md).

## Environment variables

See [`.env.example`](.env.example). Defaults match the local/Compose setup.

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/careflow` | owner/migration role (SUPERUSER or BYPASSRLS); migrations, seed, reset, demo-reset purge |
| `APP_DATABASE_URL` | `postgres://careflow_app:careflow_app_dev_only@localhost:5432/careflow` | least-privilege role for all web requests and the jobs CLI; **dev-only password** |
| `TEST_DATABASE_URL` | `…/careflow_test` | must contain “test” |
| `TEST_APP_DATABASE_URL` | `postgres://careflow_app:careflow_app_dev_only@…/careflow_test` | app role on the test DB (roles are cluster-wide: same password as `APP_DATABASE_URL`) |
| `LOGIN_LOCKOUT_MAX_FAILURES`, `LOGIN_LOCKOUT_WINDOW_SECONDS`, `LOGIN_LOCKOUT_SECONDS` | `5`, `900`, `900` | per-account sign-in lockout: N consecutive failures within the window lock that email for the cool-down, whatever the IP |
| `DEMO_RESET_ENABLED` | enabled | set `false` to disable *Settings → Reset* (and stop the web app from using `DATABASE_URL`) |
| `EXPERIMENT_HMAC_SALT` | dev value | HMAC salt for assignments; change in any shared deployment (sessions are random tokens stored as SHA-256 hashes) |
| `SEED_ANCHOR_DATE` | today | `YYYY-MM-DD` for byte-identical resets |
| `CENSUS_API_KEY`, `ACS_ZCTAS` | unset | optional real ACS refresh into the provenance table |
| `LLM_ENABLED`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | `false` | optional OpenAI-compatible paraphrasing; deterministic templates otherwise |

## External sources

US Census ACS 2024 5-year (B01001), CMS NPPES, IDEA Section 618 (context only) — see [`docs/data-sources.md`](docs/data-sources.md) for links, terms, geography caveats and stale-data rules. **The demo map uses synthetic values over fictional ZCTA-like codes 00101–00112.**

## Documentation

- [Architecture](docs/architecture.md) · [Metric definitions](docs/metric-definitions.md) · [API](docs/api.md)
- [Security & production gates](docs/security-production-gates.md) · [Data sources](docs/data-sources.md) · [Experiment design](docs/experiment-design.md)
- [Agent decisions, assumptions & known limitations](docs/agent-decisions.md) · [Implementation plan](docs/implementation-plan.md)

## Screenshots

| | |
|---|---|
| ![Intake drawer](docs/screenshots/02-intake-drawer-matches.png) | ![Capacity after edit](docs/screenshots/03b-capacity-after.png) |
| ![Missions](docs/screenshots/05b-missions.png) | ![Market map](docs/screenshots/06-market-map.png) |
| ![Approved packet](docs/screenshots/05a-approved-packet.png) | ![Experiment](docs/screenshots/05c-experiment.png) |
| ![Equity audit](docs/screenshots/09-equity-audit.png) | |
