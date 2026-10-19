# Implementation plan (as executed)

Written at the start of the build per the handoff (“brief implementation plan and assumptions log, then immediately start building”). Assumptions are maintained in [`agent-decisions.md`](agent-decisions.md).

| Milestone (PRD §17) | Delivered |
|---|---|
| 1. Foundations | pnpm/Turborepo monorepo, strict TS, Drizzle schema + generated migration + hand-written integrity/RLS migration, self-hosted auth with seeded personas, RBAC matrix, tenant-scoped services, deterministic seed, sidebar shell |
| 2. Intake system | Demo-only creation with PII guard and idempotency, CSV preview/import, event state machine with immutable events, table + Kanban + drawer, filters/queues, attribution, aggregate export |
| 3. Capacity & matching | Payer and capacity editors (optimistic locking, attestation), pure explainable matcher with hard gates, score breakdown, missing-data states; “Test a match” |
| 4. Intelligence | SQL KPI functions over the event log, dashboard, ACS adapter with fixture fallback and provenance, hex-tile market map, opportunity heuristic |
| 5. GTM action system | Mission rules M1–M7, prioritisation, dedupe, ops-gated approvals, deterministic drafts + claim validator + editor, referral partners, codes and QR, printable packet |
| 6. Measurement | Experiment lifecycle, HMAC assignment, Wilson/Newcombe analysis with “insufficient evidence”, guardrails, trend |
| 7. Polish & ship | Responsive screens, empty/error states with retry, keyboard focus, 99 unit/integration tests, 11 Playwright tests with screenshots, documentation |

## Story the seed tells

* **North** (60 inquiries): afternoon RBT availability fully booked → low verified capacity, high not-feasible share, slow first response → **M1** (hold demand, fix staffing) and **M3**.
* **South** (65): reasonable verified staffing but most benefits requests wait > 10 days → **M4**.
* **West** (25): payer fit (Meridian accepted; North doesn’t), verified morning hours plus 25 afternoon hours *pending ops verification* → no growth mission until ops verifies; then **M2/M6/M7** unlock.
