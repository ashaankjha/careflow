# Agent decisions, assumptions and known limitations

This log records judgement calls made while implementing the PRD without routine clarification, as the handoff instructed. Where the PRD was ambiguous, the smallest reliable, testable option was chosen.

## Assumptions

| # | Topic | Decision | Why |
|---|---|---|---|
| A1 | Fictional geography | “Harbor Bay” is placed over open water (≈32.95 N, −117.95 W) with ZCTA-like codes `00101–00112` that the Census Bureau does not assign. | Prevents any implication of a real practice or neighborhood. |
| A2 | Inquiry → site attribution | Added `inquiries.center_id` (routed/selected site) set at creation or by `center_match_selected`. | Per-site KPIs and rules need a deterministic site; PRD lists `selected_at` on matches but no inquiry→site column. |
| A3 | Capacity semantics | `staff_capacity_windows.weekly_available_hours` = aggregated **unbooked** verified hours in that window; hours are assumed spread uniformly across the window when intersected with family windows. Same role/day/mode windows may not overlap (validated on save). | PRD asks for interval-overlap summation with reproducible overlap handling. |
| A4 | Verification freshness | Payer participation counts as verified for 180 days, capacity windows for 30 days (tenant policy). Saving the capacity sheet as ops attests every window as verified now. | PRD requires “recent enough under tenant policy” and that unknown/unverified never asserts readiness. |
| A5 | Holds | Proposed **and** reserved holds subtract hours and count against the weekly new-start limit until released or past `expires_at` (lazy expiry at read time; `expire-holds` job records them). Staff (intake/ops/admin, `hold:reserve`) can turn a verified `potential_fit` into a **reserved** hold: one transaction locks the center row (`SELECT … FOR UPDATE`) and the inquiry row, re-evaluates against all committed holds, and returns `409 CONFLICT` when a capacity gate fails. Hours held = requested direct hours (or planning default) and the matching BCBA hours; TTL = tenant `holdTtlDays` (default 7). A proposal for the same inquiry/center is converted in place; proposals elsewhere are superseded. Reserved is **not an appointment** (UI and API copy say so). | PRD §8 transactional reservation; a row lock on the center serializes reservations with each other and with capacity edits, so concurrent reservations cannot exceed verified capacity (parallel-connection test in `holds.test.ts`). |
| A6 | Requested hours | Missing `requestedDirectHoursPerWeek` uses the tenant planning default (10) and the gate text says so. | Avoids silently dropping families. |
| A7 | Age | Age is an optional *match-request* input only (policy check); it is never stored on inquiries. | PRD forbids DOB and allows age-policy checks “where input is available”. |
| A8 | Non-inquiry domain events | `mission_approved`, `experiment_started`, `experiment_completed` are written to the immutable audit log. | `inquiry_events` requires an inquiry id. |
| A9 | Mission thresholds | Recent window 30 d; M1 ≥10 inquiries and (<5 verified h or ≥50% not-feasible while <25 verified h); M2 ≥25 verified h and <0.8× peer median inquiries; M3 >30% SLA misses with N≥10; M4 ≥5 benefits stalls; M5 ≥20-pt drop, N≥15 each, 14-day horizon; M6 ≥40% of ≥4 partner starts from one partner; M7 profile missing/outdated. All tenant-configurable. | Chosen so the seed yields exactly the three story missions and West unlocks only after ops verification. |
| A10 | Demand-increasing missions | Re-validated at approval time against current verified capacity. | Capacity may change between generation and approval. |
| A11 | Auth | Self-hosted session auth (scrypt + hashed random tokens) instead of Auth.js. | Fewer moving parts offline; PRD allows “suitable self-hosted authentication”. |
| A12 | Map | Offline SVG hex-tile choropleth instead of MapLibre + basemap tiles. | Basemap tiles require network/third-party requests (privacy, CSP, offline demo) and the geography is fictional anyway. MapLibre remains a drop-in for real ZCTA geometry later. |
| A13 | UI kit | Hand-written shadcn-style components on Radix primitives instead of the shadcn CLI. | Same patterns, no generator dependency. |
| A14 | Seed anchor | Seed timestamps are relative to “now” at seed time (or `SEED_ANCHOR_DATE`); IDs are UUIDv5 so resets reproduce the exact state. Sessions survive resets. | KPIs over “last 90 days” stay meaningful whenever the demo is reset. |
| A15 | Docker | `docker-compose.yml` is provided; the build/test environment here used a local PostgreSQL 16 service (no Docker daemon). | Same version and schema. |
| A16 | Capacity history | Every capacity save appends an immutable `capacity_versions` header (rules snapshot, `[valid_from, valid_to)`) plus `staff_capacity_window_versions` rows; capacity-fit for a cohort is evaluated as of each inquiry's `created_at` (version in force, holds active then, starts in the prior 7 days). The seed backfills five versions per site — the same sheet re-attested every 28 days back from the latest fixture attestation — so seeded numbers and the acceptance chain are unchanged. | Risk R8; keeps retrospective KPIs from being rewritten by today's capacity edits without inventing a different capacity story for the demo. |

## Compromises

* **Tenancy / RLS**: the web app connects as the non-owner `careflow_app` role and runs each API request and server-component data load in one transaction with `app.current_org` set; RLS is FORCEd on all tenant tables. Compromises: (a) sign-in and cookie resolution go through three SECURITY DEFINER functions (`careflow_auth_lookup`, `careflow_resolve_session`, `careflow_revoke_session`) because the tenant is unknown at that point; (b) *Settings → Reset demo* makes the web process use the owner `DATABASE_URL` for the cross-tenant purge + reseed (disable with `DEMO_RESET_ENABLED=false`); (c) several services are typed `Db` and receive the request transaction through a cast (a drizzle transaction exposes the same query API; nested `transaction()` calls become savepoints); (d) an `AppError` thrown inside the request transaction still commits earlier writes (keeps denial/send-attempt audits, matching the pre-RLS autocommit behaviour), other errors roll back; (e) the jobs CLI still runs as the owner role. The `careflow_app` role name is fixed in migration 0002.
* **Rate limiting** is a shared fixed-window counter in Postgres (`rate_limit_buckets`, UNLOGGED, one upsert per request) — it holds across processes/nodes but costs one DB round-trip per request, resets counters on a DB crash, is not a substitute for an edge WAF, and keys by user id (API) or `X-Forwarded-For` first hop (sign-in), which is spoofable without a trusted proxy in front.
* **CSP** allows inline scripts for Next.js bootstrapping (no third-party origins).
* **Capacity history** versions the capacity sheet (windows + rules) only; payer participation, site profile and the onboarding backlog are applied as currently recorded when evaluating past cohorts (documented in metric definitions).
* **Capacity holds** guard reservations only: a later capacity edit can reduce verified hours below already-reserved holds (the matcher then shows the shortfall; holds are not auto-released). Hold hours are subtracted from the site's weekly total rather than from specific day/time windows. The `expire-holds` job (like the other jobs) runs for one organization per invocation (Harbor by default).
* **Experiment intervals** for partner/site-week randomization use a cluster-robust ratio-estimator variance with t critical values on min(k)−1 df, floored at the unclustered interval, and stay “insufficient evidence” below 10 clusters with data per arm (documented constant, not yet a tenant setting). This is a large-sample approximation; no small-sample corrections beyond the k/(k−1) factor (e.g. Bell–McCaffrey) or permutation inference are implemented. With the seed's nine eligible partners, the seeded partner experiment can never leave “insufficient evidence”.
* **Equity audit** groups by payer *category* only (no demographic data exists by design); “match proposed” counts staff-selected sites and current proposed/reserved holds, so a hold later released no longer counts. Complementary suppression is per additive column (one dimension); it does not solve the general multi-table disclosure problem across arbitrary filter combinations (e.g. differencing two site filters).
* **Markdown rendering** for drafts uses a small escaping renderer (headings, lists, emphasis, code) rather than a full CommonMark library.
* **Turborepo** runs package tasks; there is no remote cache or CI workflow file committed (commands are documented; any CI can run them).

## Known limitations / unfinished

* No live NPPES ingestion (fixture only) and no TIGER/Line ZCTA geometry; real ACS rows fetched with a key appear in the ranking table but not on the tile map.
* No `page_session` randomization (requires first-party web instrumentation).
* Reserved capacity holds are not linked to scheduling: no appointment, session or staff assignment is created, and holds are not visible to families.
* Single locale (`en-US`); drafts are English only.
* Consent records table is a schema placeholder only.
* Dark mode is not implemented (desktop-first light theme per PRD visual language).
* Accessibility was checked via keyboard E2E and semantic markup, not a full WCAG audit.
* LLM adapter is implemented and unit-tested with mocked responses but has not been exercised against a live provider.

## Future phases (not shipped — PRD §20)

Capacity allocation via CP-SAT/MILP; Bayesian hierarchical funnel forecasting with right-censoring; geo holdouts and difference-in-differences; contextual bandits for low-risk material variants only; approved CMS / Google Business Profile publishing; enterprise intake/staffing connectors; forecast-to-hire for dayparts that unlock waitlisted families.
