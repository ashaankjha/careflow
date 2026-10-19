-- Jobs least privilege + per-account sign-in lockout (hand-written; see
-- docs/security-production-gates.md R1/R2).

-- 1. Jobs CLI tenant enumeration. The jobs CLI connects as `careflow_app` and
--    runs each job once per organization inside a transaction that sets
--    app.current_org. Under FORCEd RLS the app role cannot list organizations,
--    so this narrow SECURITY DEFINER function returns organization ids ONLY
--    (no names, settings or other columns).
CREATE OR REPLACE FUNCTION careflow_job_org_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.id FROM organizations o ORDER BY o.id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION careflow_job_org_ids() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION careflow_job_org_ids() TO careflow_app;
--> statement-breakpoint

-- 2. Per-account sign-in lockout. Not tenant data: sign-in runs before the
--    tenant is known. `account_key` is a SHA-256 hex digest of the normalized
--    email, so the table holds no email addresses, and unknown emails are
--    counted exactly like real accounts (no existence oracle). The app role
--    has NO direct privileges on this table; it goes through the three
--    SECURITY DEFINER functions below.
CREATE UNLOGGED TABLE IF NOT EXISTS login_attempts (
  account_key text PRIMARY KEY,
  failures integer NOT NULL,
  first_failure_at timestamptz NOT NULL,
  locked_until timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS login_attempts_first_failure_idx ON login_attempts (first_failure_at);
--> statement-breakpoint
-- Migration 0002's ALTER DEFAULT PRIVILEGES granted DML on new tables; take it back.
REVOKE ALL ON login_attempts FROM careflow_app;
--> statement-breakpoint

-- Returns the lock expiry when the account is currently locked, else NULL.
CREATE OR REPLACE FUNCTION careflow_login_locked_until(p_account_key text)
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.locked_until FROM login_attempts a
  WHERE a.account_key = p_account_key AND a.locked_until > now()
$$;
--> statement-breakpoint

-- Records one failed attempt atomically. The counter restarts when the
-- previous streak is older than the window or a previous lock has expired.
-- When the streak reaches p_max_failures the account is locked for
-- p_lock_seconds; `newly_locked` is true only on the attempt that set the lock.
-- Parameters are clamped so a caller cannot disable or extend locks absurdly.
CREATE OR REPLACE FUNCTION careflow_login_failure(p_account_key text, p_max_failures integer, p_window_seconds integer, p_lock_seconds integer)
RETURNS TABLE (failures integer, locked_until timestamptz, newly_locked boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_max integer := least(greatest(coalesce(p_max_failures, 5), 1), 100);
  v_window interval := make_interval(secs => least(greatest(coalesce(p_window_seconds, 900), 1), 86400));
  v_lock interval := make_interval(secs => least(greatest(coalesce(p_lock_seconds, 900), 1), 86400));
  v_row login_attempts%ROWTYPE;
  v_was_locked boolean;
BEGIN
  IF p_account_key IS NULL OR length(p_account_key) <> 64 THEN
    RAISE EXCEPTION 'invalid account key';
  END IF;
  INSERT INTO login_attempts AS a (account_key, failures, first_failure_at, locked_until)
  VALUES (p_account_key, 1, now(), NULL)
  ON CONFLICT (account_key) DO UPDATE SET
    failures = CASE
      WHEN a.locked_until IS NOT NULL AND a.locked_until <= now() THEN 1
      WHEN a.locked_until IS NULL AND a.first_failure_at < now() - v_window THEN 1
      ELSE a.failures + 1 END,
    first_failure_at = CASE
      WHEN a.locked_until IS NOT NULL AND a.locked_until <= now() THEN now()
      WHEN a.locked_until IS NULL AND a.first_failure_at < now() - v_window THEN now()
      ELSE a.first_failure_at END,
    locked_until = CASE WHEN a.locked_until IS NOT NULL AND a.locked_until <= now() THEN NULL ELSE a.locked_until END
  RETURNING a.* INTO v_row;
  v_was_locked := v_row.locked_until IS NOT NULL;
  IF NOT v_was_locked AND v_row.failures >= v_max THEN
    UPDATE login_attempts a SET locked_until = now() + v_lock WHERE a.account_key = p_account_key RETURNING a.* INTO v_row;
    RETURN QUERY SELECT v_row.failures, v_row.locked_until, true;
  ELSE
    RETURN QUERY SELECT v_row.failures, v_row.locked_until, false;
  END IF;
  -- Opportunistic cleanup of stale rows (~1% of calls), like rate_limit_buckets.
  IF random() < 0.01 THEN
    DELETE FROM login_attempts a
    WHERE (a.locked_until IS NULL AND a.first_failure_at < now() - interval '1 day')
       OR (a.locked_until IS NOT NULL AND a.locked_until < now() - interval '1 day');
  END IF;
END
$$;
--> statement-breakpoint

-- A successful sign-in clears the streak.
CREATE OR REPLACE FUNCTION careflow_login_success(p_account_key text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM login_attempts WHERE account_key = p_account_key
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION careflow_login_locked_until(text), careflow_login_failure(text, integer, integer, integer), careflow_login_success(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION careflow_login_locked_until(text), careflow_login_failure(text, integer, integer, integer), careflow_login_success(text) TO careflow_app;
