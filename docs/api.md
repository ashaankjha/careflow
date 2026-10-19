# API (`/api/v1`)

Typed Next.js route handlers in `apps/web/src/app/api/v1`. All handlers except `health` and `auth/*` run through `route(action, fn)`:

* **Auth** — HttpOnly `cf_session` cookie (random 256-bit token; only its SHA-256 is stored), `SameSite=Lax`, `Secure` in production, 8-hour expiry. Unauthenticated → `401 UNAUTHENTICATED`.
* **CSRF** — mutations (`POST/PUT/PATCH/DELETE`) must be same-origin (`Origin` host = `Host`), and bodies must be `application/json` (which also means no file uploads).
* **RBAC** — `action` is checked against the matrix in `packages/core/src/permissions.ts`; services re-check. Denials are audited.
* **Rate limits** — per user: 60 mutations/min burst (1/s refill), 300 reads burst; login 10 per IP.
* **Validation** — Zod schemas from `@careflow/core`; failures → `422 VALIDATION_FAILED` with `details: [{path, message}]`.
* **Idempotency** — creation and transitions take client-generated keys; replays return the original result (`replayed: true`).
* **Errors** — `{ "error": { "code", "message", "requestId", "details?" } }`. Codes: `UNAUTHENTICATED 401`, `FORBIDDEN 403`, `FEATURE_DISABLED 403`, `DEMO_ONLY 403`, `NOT_FOUND 404`, `INVALID_TRANSITION 409`, `CONFLICT 409`, `VALIDATION_FAILED 422`, `RATE_LIMITED 429`, `INTERNAL 500`.
* **Pagination** — `page` (1-based) and `pageSize` (≤ 200) on list endpoints; responses include `total`.

## Endpoints

| Method & path | Permission | Notes |
|---|---|---|
| `GET /health` | public | `{status, database, mode}` only |
| `POST /auth/login` · `POST /auth/logout` | public | sets/clears session cookie |
| `GET /dashboard?range=30\|60\|90&from&to&centerId&source` | `dashboard:read` | KPIs (each with numerator/denominator), funnel, stalls, trend, site matrix, attribution, provenance |
| `GET /inquiries?stage&centerId&source&ownerId&q&page&pageSize` | `inquiry:read` | `stage` also accepts `active`, `stalled` |
| `POST /inquiries` | `inquiry:create` | demo-only; `createInquirySchema`; `201` new / `200` replay |
| `GET /inquiries/:id` | `inquiry:read` | inquiry + immutable timeline (read is audited) |
| `POST /inquiries/:id/transition` | `inquiry:transition` | `{toStage, reason?, eventIdempotencyKey, centerId?}` |
| `POST /inquiries/:id/outreach` | `inquiry:transition` | logs `outreach_attempted` |
| `POST /inquiries/:id/select-center` | `matching:persist` | `center_match_selected` (not an appointment) |
| `POST /inquiries/:id/owner` | `inquiry:transition` | assign intake owner |
| `GET /inquiries/:id/matches` | `matching:evaluate` | live evaluation + saved snapshots |
| `POST /inquiries/:id/matches` | `matching:persist` | persist snapshot with gate reasons |
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
| `GET /experiments/:id/results` | `experiment:read` | arms, Wilson intervals, difference, verdict, caveats, guardrails |
| `GET/POST /partners` · `POST /partners/:id/referral-code` | `partner:read` / `partner:manage` | aggregate attribution only |
| `GET /drafts` · `GET/PUT /drafts/:id` | `mission:read` / `draft:edit` | PUT `{bodyMd, title?, revision}` → re-validated |
| `POST /drafts/generate` | `draft:generate` | `{missionId?, centerId?, partnerId?, kind, locale}`; mission must be approved |
| `POST /drafts/:id/approve` | `draft:approve` | blocked while the validator reports unsupported claims |
| `GET /drafts/:id/export?format=md\|html` | `draft:export` | approved only; local preview |
| `POST /drafts/:id/send` | any | **always `403 FEATURE_DISABLED`** (audited) |
| `GET /sources` · `GET /audit` | `sources:read` / `audit:read` | |
| `POST /demo/reset` | `demo:reset` (admin) | demo organizations only |

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
