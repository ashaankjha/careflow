# Security, privacy and production gates

**Status: synthetic sandbox. Not HIPAA-compliant, not approved for real patient data.** Code alone cannot make a deployment compliant. Excluding a diagnosis field does not, by itself, eliminate PHI: even an inquiry’s existence, contact details, payer and intake stage can be sensitive in this care context.

## Controls implemented in the MVP

| Area | Control | Evidence |
|---|---|---|
| Synthetic-only | DB `CHECK (synthetic_demo = true)` on inquiries; demo alias pattern; PII heuristics reject emails, phones, addresses, DOB-like dates, SSN-like ids, clinical terms; explicit acknowledgement checkbox; banner on every page | `intake.test.ts`, `pii-csv.test.ts`, E2E workflow 2 |
| No clinical data | No diagnosis, DOB, severity or record-upload fields exist; JSON-only bodies (no attachments) | schema, `api.test.ts` |
| AuthN | Self-hosted sessions: 256-bit random tokens, only SHA-256 stored, HttpOnly, SameSite=Lax, Secure in production, 8 h expiry; scrypt password hashes | `packages/db/src/auth.ts`, `services/session.ts` |
| AuthZ | Explicit RBAC matrix enforced in every route **and** every service; UI only mirrors it; denials audited | `permissions.ts`, `security.spec.ts`, `operations.test.ts` |
| Tenancy | Web app runs as non-owner role `careflow_app` (no SUPERUSER/BYPASSRLS, owns nothing); every API request and server-component data load runs in one transaction with transaction-local `set_config('app.current_org', orgId, true)`; `FORCE ROW LEVEL SECURITY` + `tenant_isolation` policy (all commands, `USING` + `WITH CHECK`) on every tenant table and `organizations`/`users`/`sessions`; missing tenant ⇒ no rows / writes rejected; plus composite tenant FKs and service-level scoping | `app-role.test.ts`, `tenancy.test.ts`, `api.test.ts` |
| Pre-tenant auth path | Sign-in, cookie resolution and logout use three SECURITY DEFINER functions (`careflow_auth_lookup(email)`, `careflow_resolve_session(token_hash)`, `careflow_revoke_session(token_hash)`): fixed `search_path`, one key in, at most one row out, EXECUTE revoked from PUBLIC and granted only to `careflow_app`. The session insert + audit at sign-in run in the user's own tenant transaction | `app-role.test.ts` |
| Least privilege | `careflow_app` has DML only (no TRUNCATE/DDL); no UPDATE/DELETE on `audit_logs`/`inquiry_events` (so the `careflow.allow_purge` GUC is useless to it); no INSERT/DELETE on `organizations`/`users`. `ALTER DEFAULT PRIVILEGES` grants DML on tables later migrations create; those migrations must add their own policy (a test fails if any table with `organization_id` lacks forced RLS + policy) | `0002_app_role_rls.sql`, `app-role.test.ts` |
| Maintenance path | Migrations, `db:seed`, `db:reset`, jobs CLI and the demo-reset purge use the owner role (`DATABASE_URL`), which must be SUPERUSER or BYPASSRLS (checked before seeding/reset). The web process touches it only for *Settings → Reset demo* (demo orgs, admin only, audited); `DEMO_RESET_ENABLED=false` removes even that | `demo.ts`, `app-role.test.ts` |
| Integrity | Immutable `inquiry_events` and `audit_logs` (triggers); event-order checks; idempotency keys; optimistic locking on capacity and drafts | `intake.test.ts`, `tenancy.test.ts` |
| CSRF | Same-origin check on all mutations, SameSite cookies, JSON-only bodies | `api.test.ts` |
| Rate limiting | Shared fixed-window counters in Postgres (`rate_limit_buckets`, atomic upsert; works across processes/nodes): per user 60 writes/300 reads per minute, sign-in 20/min per IP | `rate-limit.test.ts`, `api.test.ts` |
| Headers | CSP (`default-src 'self'`, no third-party script/connect), `frame-ancestors 'none'`, nosniff, `Referrer-Policy: no-referrer`, Permissions-Policy, HSTS in production | `next.config.ts` |
| Tracking | No analytics, pixels, session recorders or ad tags anywhere; no identifiers in query strings sent off-site | CSP + code review |
| Logging | Server logs contain error class/code + request id only — never request bodies | `api.test.ts` |
| Audit | Reads of inquiry details, exports, changes, approvals, denied attempts, send attempts, resets | `audit.ts`, Settings → Audit history |
| Outbound | `DeliveryProvider.send` throws `FeatureDisabled`; no publishing; intake connector disabled | `connectors.test.ts`, `operations.test.ts` |
| AI | Off by default; when enabled, payload built from an explicit allowlist of public business facts + aggregate evidence; LLM output must pass the claim validator or the template is used | `llm.ts`, `connectors.test.ts` |
| Fairness | Matcher never uses reimbursement, severity, demographics; heuristic ranks places not people; no hard stop on intake for lack of capacity (alternate path shown) | `matching.ts`, `geo.ts` |
| Equity audit | Aggregate-only payer-group access rates (`GET /equity`, `equity:read` = admin/growth/ops); tenant `minCellSize` primary + complementary suppression; counts only, no identifiers; never imported by matcher/missions (tested) | `equity.ts`, `equity.test.ts`, `analytics.test.ts`, `equity-route.test.ts` |
| Remuneration | No referral fees/gifts/bounties; validator rejects remuneration language | `content.ts` |

## Risk registry

| # | Risk | Current mitigation | Residual / blocker before PHI |
|---|---|---|---|
| R1 | ~~App connects as DB owner → RLS bypassed~~ **Mitigated in code**: non-owner `careflow_app` role, per-transaction `app.current_org`, FORCEd RLS on all tenant tables, SECURITY DEFINER pre-tenant session functions; isolation tests under the app role | Service scoping + composite FKs + enforced RLS + tests | Before PHI: independent penetration test of tenant isolation (gate 5); a real secret for `careflow_app` (the `.env.example` password is dev-only); `DEMO_RESET_ENABLED=false` and no `DATABASE_URL` in the web runtime; run the jobs CLI under a scoped role too (it still uses the owner); review every new table’s policy |
| R2 | ~~In-memory rate limiter resets per process~~ **Mitigated in code**: shared Postgres fixed-window limiter | Works across processes/nodes | Edge WAF / bot protection in front; trusted proxy so the sign-in IP key (`X-Forwarded-For`) can't be spoofed; per-account lockout; counters are UNLOGGED (lost on DB crash) |
| R3 | CSP allows `'unsafe-inline'` scripts (Next.js bootstrap) | No third-party origins | Nonce-based CSP |
| R4 | Demo passwords are public | Synthetic tenant only | SSO/OIDC with MFA; disable seeded users |
| R5 | No encryption-at-rest configuration in repo | Local dev only | Managed Postgres with KMS keys, TLS everywhere, backups tested |
| R6 | Audit log lives in the same DB | Immutable trigger | Ship to append-only external store; retention policy |
| R7 | Contact aliases are free text | Pattern + heuristics | Real contact data requires consent/authorization review, field-level encryption, access-request/deletion flows |
| R8 | Retrospective metrics silently use today's capacity | Append-only `capacity_versions` + `staff_capacity_window_versions` written on every capacity save (DB trigger: windows immutable, a version can only be closed once); capacity-fit evaluated as of inquiry time; seed backfills history; mission evidence snapshots | Version payer participation and site profile too (still applied as currently recorded); retention policy for history rows |
| R9 | Optional LLM vendor | Disabled; allowlisted payload | BAA + vendor review before enabling with any production data |
| R10 | Partner-facing reporting | None shipped (aggregate internal only) | Small-cell suppression and lawful basis review before any external sharing |
| R11 | Equity audit differencing | Per-column complementary suppression within one report; internal roles only | Users can still difference reports across filters (site, window). Before real data: disclosure review, fixed reporting windows / filter minimums, and suppression across linked tables |

## Gates before any real pilot (all required)

1. Applicability analysis with qualified healthcare privacy/security counsel (HIPAA, state law, TCPA, marketing rules, anti-kickback).
2. Business Associate Agreements with **every** vendor/subcontractor touching ePHI (hosting, database, logging, email/SMS, AI providers). Encryption features alone do not make a vendor HIPAA-eligible.
3. HIPAA Security Rule risk assessment and remediation plan.
4. Written role-based access policies; SSO/MFA; quarterly access reviews.
5. Verified tenant isolation under a non-owner DB role with forced RLS (penetration test).
6. Encryption in transit and at rest with managed keys; backup/restore tested.
7. Access/audit logging to tamper-evident storage; alerting.
8. Retention, deletion and individual access-request flows.
9. Incident and breach response plan, tested.
10. Approved analytics stack (first-party, aggregate) — still no third-party trackers on intake surfaces.
11. Consent/communications review per channel (HIPAA marketing restrictions, TCPA, state law, opt-out) before enabling any `send`.
12. Organization sign-off by privacy, security, compliance and clinical leadership.

Never market this product as “HIPAA compliant” on the basis of code.

## Verification notes (tenancy / rate limiting)

* Verified locally on PostgreSQL 16 (no Docker): migrations from a dropped-and-recreated database **and** a dropped `careflow_app` role, migrate run twice (idempotent), `db:reset`, `pnpm test` (isolation under the app role in `packages/db/test/app-role.test.ts`) and the full Playwright suite with the web app connected as `careflow_app`.
* `docker-compose.yml` was checked by reading only (Docker is unavailable in the build environment): the `postgres` superuser matches `DATABASE_URL`, `scripts/init-test-db.sql` creates `careflow_test`, and the app role is created by `pnpm db:migrate`, not by the container. Not verified: running the Compose stack itself.
