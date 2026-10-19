-- Tenancy hardening (hand-written; see docs/security-production-gates.md R1/R2).
--
-- The web app connects as the NON-OWNER role `careflow_app` and runs every
-- request inside a transaction that calls
--   set_config('app.current_org', <orgId>, true)
-- RLS is FORCEd on every tenant table, so even the table owner is subject to
-- the policies unless it is a superuser / BYPASSRLS role (the migration, seed
-- and demo-reset path run as such a role via DATABASE_URL).

-- 1. Application role. Created NOLOGIN without a password so no secret lives in
--    a migration; `pnpm db:migrate` sets LOGIN + password from APP_DATABASE_URL.
--    Roles are cluster-wide, so this must be idempotent across databases.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'careflow_app') THEN
    CREATE ROLE careflow_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
END $$;
--> statement-breakpoint

-- 2. Shared rate-limit store (fixed window). Not tenant data: keys are
--    "<userId>:<r|w>" or "login:<ip>". UNLOGGED: losing counters on a crash is
--    acceptable and avoids WAL traffic on every request.
CREATE UNLOGGED TABLE IF NOT EXISTS rate_limit_buckets (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rate_limit_buckets_window_idx ON rate_limit_buckets (window_start);
--> statement-breakpoint

-- 3. Privileges. Least privilege: no TRUNCATE, no DDL, no UPDATE/DELETE on the
--    immutable logs (the purge escape hatch `careflow.allow_purge` is a plain
--    GUC any role could set, so the app must not hold DELETE on those tables).
GRANT USAGE ON SCHEMA public TO careflow_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO careflow_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO careflow_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON audit_logs, inquiry_events FROM careflow_app;
--> statement-breakpoint
REVOKE INSERT, DELETE ON organizations, users FROM careflow_app;
--> statement-breakpoint
-- Tables created later by the migration role inherit the same grants; later
-- migrations must add their own RLS policy in the same style.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO careflow_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO careflow_app;
--> statement-breakpoint

-- 4. Row-level security: ENABLE + FORCE everywhere. Policies without a FOR
--    clause apply to SELECT, INSERT, UPDATE and DELETE (USING + WITH CHECK).
--    A missing/empty app.current_org yields NULL, which matches no row
--    (reads return nothing, writes fail the WITH CHECK) — fail closed.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'centers','payers','center_payers','staff_capacity_windows','capacity_rules','inquiries',
    'inquiry_events','inquiry_center_matches','capacity_holds','referral_partners','referral_codes',
    'campaigns','experiments','experiment_variants','experiment_assignments','mission_evidence',
    'missions','content_drafts','geo_signals','source_snapshots','daily_metrics','audit_logs',
    'consent_records','users','sessions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = nullif(current_setting(''app.current_org'', true), '''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''app.current_org'', true), '''')::uuid)',
      t);
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON organizations
  USING (id = nullif(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.current_org', true), '')::uuid);
--> statement-breakpoint

-- 5. Pre-tenant lookups. Sign-in and cookie resolution happen before the org
--    is known, so they go through three narrow SECURITY DEFINER functions
--    (owned by the migration role, which bypasses RLS). Each takes exactly one
--    secret-derived key and returns at most one row; nothing else is exposed.
CREATE OR REPLACE FUNCTION careflow_auth_lookup(p_email text)
RETURNS TABLE (user_id uuid, organization_id uuid, password_hash text, role user_role, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.organization_id, u.password_hash, u.role, u.display_name
  FROM users u WHERE u.email = lower(trim(p_email)) LIMIT 1
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION careflow_resolve_session(p_token_hash text)
RETURNS TABLE (user_id uuid, organization_id uuid, email text, display_name text, role user_role,
               org_name text, demo_mode boolean, timezone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.organization_id, u.email, u.display_name, u.role, o.name, o.demo_mode, o.timezone
  FROM sessions s
  JOIN users u ON u.id = s.user_id AND u.organization_id = s.organization_id
  JOIN organizations o ON o.id = u.organization_id
  WHERE s.token_hash = p_token_hash AND s.expires_at > now()
  LIMIT 1
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION careflow_revoke_session(p_token_hash text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM sessions WHERE token_hash = p_token_hash
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION careflow_auth_lookup(text), careflow_resolve_session(text), careflow_revoke_session(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION careflow_auth_lookup(text), careflow_resolve_session(text), careflow_revoke_session(text) TO careflow_app;
