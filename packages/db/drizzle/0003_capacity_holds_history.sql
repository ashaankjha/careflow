-- Capacity reservation holds + capacity history versioning (hand-written; see docs/agent-decisions.md A5, risk R8).

-- 1. Hold lifecycle columns. A hold is "reserved" once staff reserve verified
--    capacity inside a locked transaction (packages/db/src/services/holds.ts).
--    Reserved is still NOT an appointment. Released/expired holds keep their row
--    so capacity as-of a past time can be reconstructed.
ALTER TABLE capacity_holds ADD COLUMN reserved_at timestamptz;
--> statement-breakpoint
ALTER TABLE capacity_holds ADD COLUMN released_at timestamptz;
--> statement-breakpoint
ALTER TABLE capacity_holds ADD COLUMN released_by uuid;
--> statement-breakpoint
ALTER TABLE capacity_holds ADD COLUMN release_reason text;
--> statement-breakpoint
ALTER TABLE capacity_holds ADD CONSTRAINT capacity_holds_reserved_at_ck CHECK (status <> 'reserved' OR reserved_at IS NOT NULL);
--> statement-breakpoint
ALTER TABLE capacity_holds ADD CONSTRAINT capacity_holds_released_at_ck CHECK (status <> 'released' OR released_at IS NOT NULL);
--> statement-breakpoint
ALTER TABLE capacity_holds ADD CONSTRAINT capacity_holds_hours_ck CHECK (direct_weekly_hours_estimate >= 0 AND bcba_weekly_hours_estimate >= 0);
--> statement-breakpoint
-- At most one reserved hold per inquiry (expired-but-unswept holds are swept inside the reserving transaction).
CREATE UNIQUE INDEX capacity_holds_one_reserved_uq ON capacity_holds (inquiry_id) WHERE status = 'reserved';
--> statement-breakpoint
CREATE INDEX capacity_holds_center_idx ON capacity_holds (organization_id, center_id, status);
--> statement-breakpoint

-- 2. Capacity history. Every capacity save writes a new immutable version
--    (header + one row per staff window); the previous open version is closed by
--    setting valid_to. Capacity-fit for past cohorts reads the version valid at
--    inquiry time.
CREATE TABLE capacity_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  center_id uuid NOT NULL,
  version integer NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  attested boolean NOT NULL DEFAULT false,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT capacity_versions_org_id_uq UNIQUE (organization_id, id),
  CONSTRAINT capacity_versions_center_version_uq UNIQUE (organization_id, center_id, version),
  CONSTRAINT capacity_versions_center_fk FOREIGN KEY (organization_id, center_id) REFERENCES centers(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT capacity_versions_range_ck CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
--> statement-breakpoint
CREATE UNIQUE INDEX capacity_versions_one_open_uq ON capacity_versions (center_id) WHERE valid_to IS NULL;
--> statement-breakpoint
CREATE INDEX capacity_versions_center_idx ON capacity_versions (organization_id, center_id, valid_from);
--> statement-breakpoint
CREATE TABLE staff_capacity_window_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  center_id uuid NOT NULL,
  capacity_version_id uuid NOT NULL,
  role staff_role NOT NULL,
  day_of_week smallint NOT NULL,
  start_minute smallint NOT NULL,
  end_minute smallint NOT NULL,
  weekly_available_hours double precision NOT NULL,
  service_mode text NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scwv_version_fk FOREIGN KEY (organization_id, capacity_version_id) REFERENCES capacity_versions(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT scwv_center_fk FOREIGN KEY (organization_id, center_id) REFERENCES centers(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT scwv_day_ck CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT scwv_minutes_ck CHECK (start_minute >= 0 AND end_minute <= 1440 AND end_minute > start_minute),
  CONSTRAINT scwv_hours_ck CHECK (weekly_available_hours >= 0)
);
--> statement-breakpoint
CREATE INDEX scwv_version_idx ON staff_capacity_window_versions (organization_id, capacity_version_id);
--> statement-breakpoint

-- 3. History is append-only: window rows never change; a version header may only
--    be closed once (valid_to NULL -> timestamp). DELETE only on the demo-reset /
--    retention path that sets careflow.allow_purge.
CREATE OR REPLACE FUNCTION careflow_capacity_version_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('careflow.allow_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;
  ELSIF OLD.valid_to IS NULL AND NEW.valid_to IS NOT NULL
        AND (to_jsonb(NEW) - 'valid_to') = (to_jsonb(OLD) - 'valid_to') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'IMMUTABLE_RECORD: % on % is not permitted', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER capacity_versions_immutable BEFORE UPDATE OR DELETE ON capacity_versions
  FOR EACH ROW EXECUTE FUNCTION careflow_capacity_version_guard();
--> statement-breakpoint
CREATE TRIGGER staff_capacity_window_versions_immutable BEFORE UPDATE OR DELETE ON staff_capacity_window_versions
  FOR EACH ROW EXECUTE FUNCTION careflow_forbid_mutation();
--> statement-breakpoint

-- 4. Tenant isolation for the new tables (forced, so it also binds the table owner).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['capacity_versions','staff_capacity_window_versions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = nullif(current_setting(''app.current_org'', true), '''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''app.current_org'', true), '''')::uuid)',
      t);
  END LOOP;
END $$;
