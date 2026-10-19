# Security, privacy and production gates

**Status: synthetic sandbox. Not HIPAA-compliant, not approved for real patient data.** Code alone cannot make a deployment compliant. Excluding a diagnosis field does not, by itself, eliminate PHI: even an inquiry’s existence, contact details, payer and intake stage can be sensitive in this care context.

## Controls implemented in the MVP

| Area | Control | Evidence |
|---|---|---|
| Synthetic-only | DB `CHECK (synthetic_demo = true)` on inquiries; demo alias pattern; PII heuristics reject emails, phones, addresses, DOB-like dates, SSN-like ids, clinical terms; explicit acknowledgement checkbox; banner on every page | `intake.test.ts`, `pii-csv.test.ts`, E2E workflow 2 |
| No clinical data | No diagnosis, DOB, severity or record-upload fields exist; JSON-only bodies (no attachments) | schema, `api.test.ts` |
| AuthN | Self-hosted sessions: 256-bit random tokens, only SHA-256 stored, HttpOnly, SameSite=Lax, Secure in production, 8 h expiry; scrypt password hashes | `packages/db/src/auth.ts`, `services/session.ts` |
| AuthZ | Explicit RBAC matrix enforced in every route **and** every service; UI only mirrors it; denials audited | `permissions.ts`, `security.spec.ts`, `operations.test.ts` |
| Tenancy | Composite tenant FKs, service-level scoping, RLS policies (defense in depth) | `tenancy.test.ts` |
| Integrity | Immutable `inquiry_events` and `audit_logs` (triggers); event-order checks; idempotency keys; optimistic locking on capacity and drafts | `intake.test.ts`, `tenancy.test.ts` |
| CSRF | Same-origin check on all mutations, SameSite cookies, JSON-only bodies | `api.test.ts` |
| Rate limiting | Per-user and per-IP token buckets (in-memory) | `rate-limit.ts` |
| Headers | Per-request nonce CSP (`script-src 'self' 'nonce-…' 'strict-dynamic'`, no `'unsafe-inline'`/`'unsafe-eval'` scripts in production; `default-src 'self'`, no third-party script/connect, `object-src 'none'`, `frame-ancestors 'none'`); `style-src` keeps `'unsafe-inline'` for React/Radix/Recharts style attributes; nosniff, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, Permissions-Policy, HSTS in production | `middleware.ts` (CSP), `next.config.ts` (static headers), `middleware.test.ts`, `security.spec.ts` |
| Tracking | No analytics, pixels, session recorders or ad tags anywhere; no identifiers in query strings sent off-site | CSP + code review |
| Logging | Server logs contain error class/code + request id only — never request bodies | `api.test.ts` |
| Audit | Reads of inquiry details, exports, changes, approvals, denied attempts, send attempts, resets | `audit.ts`, Settings → Audit history |
| Outbound | `DeliveryProvider.send` throws `FeatureDisabled`; no publishing; intake connector disabled | `connectors.test.ts`, `operations.test.ts` |
| AI | Off by default; when enabled, payload built from an explicit allowlist of public business facts + aggregate evidence; LLM output must pass the claim validator or the template is used | `llm.ts`, `connectors.test.ts` |
| Fairness | Matcher never uses reimbursement, severity, demographics; heuristic ranks places not people; no hard stop on intake for lack of capacity (alternate path shown) | `matching.ts`, `geo.ts` |
| Remuneration | No referral fees/gifts/bounties; validator rejects remuneration language | `content.ts` |

## Risk registry

| # | Risk | Current mitigation | Residual / blocker before PHI |
|---|---|---|---|
| R1 | App connects as DB owner → RLS bypassed | Service scoping + composite FKs + tests | **Blocker**: run as non-owner role; set `app.current_org` per transaction; `FORCE ROW LEVEL SECURITY` |
| R2 | In-memory rate limiter resets per process | Fine for single-node demo | Shared store (Redis/DB) behind a WAF |
| R3 | Inline-script injection | Nonce-based CSP with `'strict-dynamic'` set in middleware; every page is dynamically rendered so each response carries a fresh nonce; E2E asserts no `'unsafe-inline'` in `script-src`, nonces on Next scripts and no CSP console violations | `style-src 'unsafe-inline'` remains (style attributes); add CSP violation reporting (`report-to`) and review before PHI |
| R4 | Demo passwords are public | Synthetic tenant only | SSO/OIDC with MFA; disable seeded users |
| R5 | No encryption-at-rest configuration in repo | Local dev only | Managed Postgres with KMS keys, TLS everywhere, backups tested |
| R6 | Audit log lives in the same DB | Immutable trigger | Ship to append-only external store; retention policy |
| R7 | Contact aliases are free text | Pattern + heuristics | Real contact data requires consent/authorization review, field-level encryption, access-request/deletion flows |
| R8 | Capacity history not versioned | Evidence snapshots on missions | Versioned capacity for retrospective metrics |
| R9 | Optional LLM vendor | Disabled; allowlisted payload | BAA + vendor review before enabling with any production data |
| R10 | Partner-facing reporting | None shipped (aggregate internal only) | Small-cell suppression and lawful basis review before any external sharing |

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
