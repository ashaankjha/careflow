-- Integrity & tenancy hardening (hand-written; see docs/architecture.md).

-- 1. Immutable event log and audit log. UPDATE is never allowed; DELETE only
--    under the documented admin retention / demo-reset path, which sets
--    careflow.allow_purge = 'on' for its own transaction.
CREATE OR REPLACE FUNCTION careflow_forbid_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('careflow.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'IMMUTABLE_RECORD: % on % is not permitted', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER inquiry_events_immutable BEFORE UPDATE OR DELETE ON inquiry_events
  FOR EACH ROW EXECUTE FUNCTION careflow_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION careflow_forbid_mutation();
--> statement-breakpoint

-- 2. Event ordering: an event may not precede its inquiry's creation, nor be in the future (> 5 min skew).
CREATE OR REPLACE FUNCTION careflow_check_event_time() RETURNS trigger AS $$
DECLARE created timestamptz;
BEGIN
  SELECT created_at INTO created FROM inquiries WHERE id = NEW.inquiry_id AND organization_id = NEW.organization_id;
  IF created IS NULL THEN
    RAISE EXCEPTION 'EVENT_ORDER: inquiry % not found in organization', NEW.inquiry_id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.occurred_at < created - interval '1 second' THEN
    RAISE EXCEPTION 'EVENT_ORDER: event precedes inquiry creation' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.occurred_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'EVENT_ORDER: event time is in the future' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER inquiry_events_time_check BEFORE INSERT ON inquiry_events
  FOR EACH ROW EXECUTE FUNCTION careflow_check_event_time();
--> statement-breakpoint

-- 3. Row-level security as defense in depth. The application always scopes by
--    organization_id in query helpers; in production the app connects as a
--    non-owner role and sets app.current_org per transaction so these policies
--    apply. (Table owners/superusers bypass RLS — documented in security gates.)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'centers','payers','center_payers','staff_capacity_windows','capacity_rules','inquiries',
    'inquiry_events','inquiry_center_matches','capacity_holds','referral_partners','referral_codes',
    'campaigns','experiments','experiment_variants','experiment_assignments','mission_evidence',
    'missions','content_drafts','geo_signals','source_snapshots','daily_metrics','audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = nullif(current_setting(''app.current_org'', true), '''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''app.current_org'', true), '''')::uuid)',
      t);
  END LOOP;
END $$;
