# API (`/api/v1`)

Typed Next.js route handlers in `apps/web/src/app/api/v1`. All handlers except `health`, `csp-report` and `auth/*` run through `route(action, fn)`:

* **Auth** — HttpOnly `cf_session` cookie (random 256-bit token; only its SHA-256 is stored), `SameSite=Lax`, `Secure` in production, 8-hour expiry. Unauthenticated → `401 UNAUTHENTICATED`.
* **CSRF** — mutations (`POST/PUT/PATCH/DELETE`) must be same-origin (`Origin` host = `Host`), and bodies must be `application/json` (which also means no file uploads).
* **RBAC** — `action` is checked against the matrix in `packages/core/src/permissions.ts`; services re-check. Denials are audited.
* **Rate limits** — shared fixed 60-second windows stored in Postgres (`rate_limit_buckets`), so they hold across processes: per user 60 mutations/min and 300 reads/min; sign-in 20/min per client IP (first `X-Forwarded-For` hop). Exceeding → `429 RATE_LIMITED`.
* **Tenancy** — after authentication the handler runs inside one transaction on the least-privilege `careflow_app` role with `app.current_org` set to the session’s organization, so Postgres RLS applies to every query (the handler also receives it as `db`).
* **Validation** — Zod schemas from `@careflow/core`; failures → `422 VALIDATION_FAILED` with `details: [{path, message}]`.
* **Idempotency** — creation and transitions take client-generated keys; replays return the original result (`replayed: true`).
* **Errors** — `{ "error": { "code", "message", "requestId", "details?" } }`. Codes: `UNAUTHENTICATED 401`, `FORBIDDEN 403`, `FEATURE_DISABLED 403`, `DEMO_ONLY 403`, `NOT_FOUND 404`, `INVALID_TRANSITION 409`, `CONFLICT 409`, `VALIDATION_FAILED 422`, `RATE_LIMITED 429`, `INTERNAL 500`.
* **Pagination** — `page` (1-based) and `pageSize` (≤ 200) on list endpoints; responses include `total`.

## Endpoints

| Method & path | Permission | Notes |
|---|---|---|
| `GET /health` | public | `{status, database, mode}` only |
| `POST /auth/login` · `POST /auth/logout` | public | sets/clears session cookie |
| `POST /csp-report` | public | CSP violation reports from browsers (`application/csp-report` or `application/reports+json`); no session or same-origin check (browsers send without credentials); body ≤ 8 KB (`413`), other content types `415`, malformed `400`, 30/min per client IP (`429`); logs only directive names, blocked origin/keyword and document path (no query string, sample or body); `204` |
| `GET /dashboard?range=30\|60\|90&from&to&centerId&source` | `dashboard:read` | KPIs (each with numerator/denominator; `capacity_fit_rate` is evaluated as of each inquiry's creation time, `asOf`, `withoutCapacityVersion`), funnel, stalls, trend, site matrix, attribution, provenance |
| `GET /inquiries?stage&centerId&source&ownerId&q&page&pageSize` | `inquiry:read` | `stage` also accepts `active`, `stalled` |
| `POST /inquiries` | `inquiry:create` | demo-only; `createInquirySchema`; `201` new / `200` replay |
| `GET /inquiries/:id` | `inquiry:read` | inquiry + immutable timeline (read is audited) |
| `POST /inquiries/:id/transition` | `inquiry:transition` | `{toStage, reason?, eventIdempotencyKey, centerId?}` |
| `POST /inquiries/:id/outreach` | `inquiry:transition` | logs `outreach_attempted` |
| `POST /inquiries/:id/select-center` | `matching:persist` | `center_match_selected` (not an appointment) |
| `POST /inquiries/:id/owner` | `inquiry:transition` | assign intake owner |
| `GET /inquiries/:id/matches` | `matching:evaluate` | live evaluation + saved snapshots |
| `POST /inquiries/:id/matches` | `matching:persist` | persist snapshot with gate reasons |
| `GET /inquiries/:id/holds` | `inquiry:read` | capacity holds (newest first) with `effectiveStatus` (`expired` when past `expiresAt`), the hold disclaimer, and `canReserve`/`canRelease` UI hints |
| `POST /inquiries/:id/holds` | `hold:reserve` | `{centerId}` → reserve verified capacity (see below); `{hold, created, disclaimer}` |
| `POST /holds/:id/release` | `hold:release` | `{reason?}`; idempotent → `{hold, released}` |
| `POST /inquiries/import` | `inquiry:import` | `{csv, commit}`; preview with line errors; idempotent on `(org, source, external_id)` |
| `GET /inquiries/template` | `inquiry:read` | demo CSV template |
| `GET /inquiries/export` | `inquiry:export_aggregate` | aggregate-only CSV (audited) |
| `GET/PUT /centers/:id/capacity` | `capacity:read` / `capacity:edit` | PUT `{version, windows[], rules[], attestVerified}`; optimistic lock → `409` |
| `GET/PUT /centers/:id/payers` | `capacity:read` / `payer:edit` | PUT `{payers:[{payerId,status,notes?}]}`; stamps verifier + time |
| `POST /matching/evaluate` | `matching:evaluate` | non-persistent; see example below |
| `GET /market/zctas?bbox=minLng,minLat,maxLng,maxLat&layer=` | `market:read` | layers, opportunity breakdown, confidence, provenance |
| `POST /market/refresh` | `market:refresh` (admin) | ACS (optional) with fixture fallback; auditable run results |
| `GET /missions?status&centerId` | `mission:read` | with evidence, drafts, experiments |
| `POST /missions/generate` | `mission:generate` | `{created, refreshed, unchanged}` |
| `POST /missions/:id/approve` · `/reject` | `mission:approve` (+ `mission:approve_ops_gated` when required) | approval re-checks capacity for demand missions |
| `POST /missions/:id/status` | `mission:status` | `in_progress` / `done` |
| `GET/POST /experiments` | `experiment:read` / `experiment:manage` | `createExperimentSchema` (randomized needs ≥2 variants summing to 100, unit ≠ none) |
| `POST /experiments/:id/start` · `/complete` | `experiment:manage` | start persists HMAC assignments for randomized designs |
| `GET /experiments/:id/results` | `experiment:read` | arms, intervals (`intervalMethod`: `wilson_newcombe`, or `cluster_robust` for partner/site-week randomization with `clustersWithData` per arm and `minClustersPerArm`), difference (+ `df`), verdict, caveats, guardrails |
| `GET /equity?days=30..365&centerId=` | `equity:read` (admin, growth, ops) | equity audit: aggregate payer-group access rates with small-cell suppression — see below |
| `GET/POST /partners` · `POST /partners/:id/referral-code` | `partner:read` / `partner:manage` | aggregate attribution only |
| `GET /drafts` · `GET/PUT /drafts/:id` | `mission:read` / `draft:edit` | PUT `{bodyMd, title?, revision}` → re-validated |
| `POST /drafts/generate` | `draft:generate` | `{missionId?, centerId?, partnerId?, kind, locale}`; `locale` is `en-US` (default) or `es-US`; mission must be approved. `es-US` templates are machine-authored (needs qualified human translator review before any real use) and start with a hidden HTML-comment note saying so; the claim validator checks English and Spanish prohibited phrasing on every draft |
| `POST /drafts/:id/approve` | `draft:approve` | blocked while the validator reports unsupported claims |
| `GET /drafts/:id/export?format=md\|html` | `draft:export` | approved only; local preview. HTML is a standalone document with `<html lang>` set to the draft locale (also sent as `Content-Language`) |
| `POST /drafts/:id/send` | any | **always `403 FEATURE_DISABLED`** (audited) |
| `GET /sources` · `GET /audit` | `sources:read` / `audit:read` | |
| `POST /demo/reset` | `demo:reset` (admin) | demo organizations only; `403 FEATURE_DISABLED` when `DEMO_RESET_ENABLED=false` |

## Capacity holds (`POST /inquiries/:id/holds`)

A reserved hold sets aside verified staff hours for one family. **It is not an appointment**, a scheduled session, or a benefits/clinical determination.

* Runs in one transaction that locks the center row (`SELECT … FOR UPDATE`; capacity edits update the same row) and the inquiry row, then re-evaluates the match against every committed hold. Concurrent reservations therefore never exceed verified RBT/BCBA hours or the weekly new-start limit.
* Only a verified `potential_fit` can be reserved. A failing capacity gate (RBT schedule, BCBA supervision, weekly new-start limit) → `409 CONFLICT` with the failing gates in `details`; any other non-fit (payer unknown, unverified hours, …) → `422 VALIDATION_FAILED`. Inquiry must be in an active stage.
* Hours held = requested direct hours (or the planning default) and `requested × supervision ratio` BCBA hours. `expiresAt = now + holdTtlDays` (tenant policy, default 7).
* An existing *proposed* hold for the same inquiry and center is converted in place; proposals at other centers are released (`superseded`). Re-reserving the same center while active returns the existing hold (`created: false`); a reserved hold at another center → `409`.
* Writes `capacity_hold_reserved` / `capacity_hold_released` / `capacity_hold_expired` inquiry events and `hold.*` audit entries. Expired holds stop subtracting capacity immediately (lazy expiry at read time); `pnpm jobs expire-holds` marks them released.

```json
{ "hold": { "id": "…", "centerId": "…", "status": "reserved", "effectiveStatus": "reserved", "active": true,
            "directWeeklyHoursEstimate": 6, "bcbaWeeklyHoursEstimate": 0.6,
            "reservedAt": "2026-10-01T18:00:00.000Z", "expiresAt": "2026-10-08T18:00:00.000Z", "centerName": "South Center" },
  "created": true,
  "disclaimer": "A reserved capacity hold temporarily sets aside verified staff hours for this family. It is not an appointment, …" }
```

## Example: `POST /matching/evaluate`

```json
{
  "serviceZip": "00106",
  "payerId": "<Meridian payer uuid>",
  "preferredModes": ["center"],
  "preferredWindows": [{ "dayOfWeek": 1, "startMinute": 840, "endMinute": 1080 }],
  "requestedDirectHoursPerWeek": 6
}
```

```json
{
  "status": "potential_fit",
  "matches": [{
    "centerId": "…", "centerName": "West Center", "eligibility": "potential_fit", "score": 79.6, "distanceMiles": 8.5,
    "capacityEvidenceAt": "2026-10-19T02:30:00.000Z",
    "gates": [
      { "key": "payer", "label": "Payer participation", "status": "pass", "reason": "Meridian Medicaid Plan (DEMO): staff verified site participation 18 days ago; individual benefits unverified" },
      { "key": "rbt_schedule", "label": "RBT schedule fit", "status": "pass", "reason": "12.8 verified RBT h/wk overlap family windows after 0.0 h holds; 6.0 requested h/wk" }
    ],
    "scoreComponents": { "schedule": 1, "capacity": 1, "distance": 0.23, "backlog": 0.77 }
  }],
  "requiredStaffActions": ["Verify individual benefits and required authorization (not determined by CareFlow)", "Confirm clinician scheduling with the site — no appointment is reserved"],
  "disclaimer": "Potential operational fit only. …"
}
```

(Illustrative synthetic output, not an assertion of real availability.)

## Equity audit: `GET /equity`

Aggregate-only, descriptive access rates per payer group for the inquiry creation cohort in the last `days` (default 90; 30–365), optionally one site. **Equity audit only — never used for scoring, ranking, matching or exclusion.** Returns counts only (no inquiry identifiers). `422` on invalid `days`/`centerId`, `404` for a site outside the tenant, `403` for intake/viewer roles.

```json
{
  "notice": "Equity audit only — never used for scoring, ranking, matching or exclusion. …",
  "minCellSize": 5,
  "window": { "from": "…", "to": "…", "days": 90 },
  "steps": [{ "key": "contact_within_sla", "label": "First contact within SLA", "denominatorLabel": "…" }, …],
  "overall": { "key": "overall", "label": "All payer groups", "inquiries": 150, "inquiriesSuppressed": null,
               "steps": { "care_started": { "numerator": 30, "denominator": 150, "rate": 0.2, "differenceVsOverall": 0, "suppressed": null }, … } },
  "groups": [{ "key": "not_recorded", "label": "Payer not recorded", "inquiries": 18,
               "steps": { "contact_within_sla": { "numerator": null, "denominator": null, "rate": null, "differenceVsOverall": null, "suppressed": "primary" }, … } }, …],
  "suppressedCells": 4,
  "caveats": ["…"]
}
```

`suppressed` is `"primary"` (small cell), `"complementary"` (hidden so a small cell cannot be derived from totals) or `null`. Definitions: [metric definitions](metric-definitions.md#equity-audit-access-rates-by-payer-group).
