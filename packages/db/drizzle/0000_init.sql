CREATE TYPE "public"."approval_status" AS ENUM('draft', 'needs_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."assignment_unit" AS ENUM('partner', 'site_week', 'page_session', 'none');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'approved', 'active', 'paused', 'completed');--> statement-breakpoint
CREATE TYPE "public"."campaign_type" AS ENUM('SEO', 'referral', 'form_ux', 'capacity_ops', 'other');--> statement-breakpoint
CREATE TYPE "public"."design_type" AS ENUM('randomized', 'quasi_experimental', 'observational');--> statement-breakpoint
CREATE TYPE "public"."draft_kind" AS ENUM('seo_page', 'partner_packet', 'referral_email', 'internal_plan');--> statement-breakpoint
CREATE TYPE "public"."experiment_status" AS ENUM('draft', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."hold_status" AS ENUM('proposed', 'reserved', 'released');--> statement-breakpoint
CREATE TYPE "public"."mission_status" AS ENUM('proposed', 'approved', 'rejected', 'in_progress', 'done');--> statement-breakpoint
CREATE TYPE "public"."payer_status" AS ENUM('verified_accepted', 'not_accepted', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'growth', 'intake', 'ops', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('RBT', 'BCBA');--> statement-breakpoint
CREATE TYPE "public"."inquiry_stage" AS ENUM('new', 'contacted', 'qualified', 'benefits_pending', 'benefits_verified', 'assessment_pending', 'authorization_pending', 'ready_to_start', 'started', 'waitlisted', 'closed_unserviceable', 'withdrawn', 'inactive');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"actor_id" uuid,
	"actor_role" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"event_time" timestamp with time zone DEFAULT now() NOT NULL,
	"allowed" boolean NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "campaign_type" NOT NULL,
	"center_id" uuid NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"owner_user_id" uuid,
	"budget" double precision,
	CONSTRAINT "campaigns_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "capacity_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"inquiry_id" uuid NOT NULL,
	"center_id" uuid NOT NULL,
	"direct_weekly_hours_estimate" double precision NOT NULL,
	"bcba_weekly_hours_estimate" double precision NOT NULL,
	"status" "hold_status" DEFAULT 'proposed' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"assigned_by" uuid
);
--> statement-breakpoint
CREATE TABLE "capacity_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"center_id" uuid NOT NULL,
	"payer_id" uuid,
	"required_bcba_hours_per_direct_hour" double precision,
	"min_rbt_coverage" double precision,
	"max_new_starts_per_week" integer,
	"is_verified" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "center_payers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"center_id" uuid NOT NULL,
	"payer_id" uuid NOT NULL,
	"status" "payer_status" DEFAULT 'unknown' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"verified_by" uuid,
	"notes" text,
	CONSTRAINT "center_payers_uq" UNIQUE("center_id","payer_id")
);
--> statement-breakpoint
CREATE TABLE "centers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address_line" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"zip" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"service_modes" text[] NOT NULL,
	"service_radius_miles" double precision NOT NULL,
	"accepted_age_min" smallint,
	"accepted_age_max" smallint,
	"active" boolean DEFAULT true NOT NULL,
	"intake_phone" text NOT NULL,
	"intake_email" text NOT NULL,
	"public_profile_status" text DEFAULT 'current' NOT NULL,
	"capacity_version" integer DEFAULT 0 NOT NULL,
	"capacity_verified_at" timestamp with time zone,
	"capacity_verified_by" uuid,
	"demo_fixture" boolean DEFAULT true NOT NULL,
	CONSTRAINT "centers_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"channel" text NOT NULL,
	"captured_text_version" text NOT NULL,
	"lawful_basis" text NOT NULL,
	"opted_out_at" timestamp with time zone,
	"enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"mission_id" uuid,
	"center_id" uuid NOT NULL,
	"partner_id" uuid,
	"kind" "draft_kind" NOT NULL,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"title" text NOT NULL,
	"body_md" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"approval_status" "approval_status" DEFAULT 'draft' NOT NULL,
	"validation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generator" text DEFAULT 'template' NOT NULL,
	"reviewer_id" uuid,
	"approved_at" timestamp with time zone,
	"facts_snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drafts_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "daily_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"center_id" uuid,
	"day" text NOT NULL,
	"metric_key" text NOT NULL,
	"segment_key" text DEFAULT 'all' NOT NULL,
	"numerator" double precision NOT NULL,
	"denominator" double precision,
	"value" double precision,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_refresh_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "experiment_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"experiment_id" uuid NOT NULL,
	"unit_hmac" text NOT NULL,
	"variant_id" uuid NOT NULL,
	"unit_ref" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignments_unit_uq" UNIQUE("experiment_id","unit_hmac")
);
--> statement-breakpoint
CREATE TABLE "experiment_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"experiment_id" uuid NOT NULL,
	"key" text NOT NULL,
	"description" text NOT NULL,
	"allocation_pct" double precision NOT NULL,
	CONSTRAINT "variants_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "variants_key_uq" UNIQUE("experiment_id","key")
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid,
	"mission_id" uuid,
	"center_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hypothesis" text NOT NULL,
	"primary_metric" text NOT NULL,
	"guardrail_metrics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assignment_unit" "assignment_unit" DEFAULT 'none' NOT NULL,
	"design_type" "design_type" DEFAULT 'observational' NOT NULL,
	"status" "experiment_status" DEFAULT 'draft' NOT NULL,
	"baseline_days" integer DEFAULT 60 NOT NULL,
	"planned_duration_days" integer DEFAULT 56 NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"owner_user_id" uuid,
	"analysis_notes" text,
	"simulated" boolean DEFAULT true NOT NULL,
	CONSTRAINT "experiments_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "experiments_none_not_randomized_ck" CHECK (not ("experiments"."assignment_unit" = 'none' and "experiments"."design_type" = 'randomized'))
);
--> statement-breakpoint
CREATE TABLE "geo_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"zcta5" text NOT NULL,
	"label" text NOT NULL,
	"as_of_year" integer NOT NULL,
	"child_0_14_est" integer,
	"child_0_14_moe" integer,
	"provider_listing_count" integer,
	"internal_inquiry_count" integer DEFAULT 0 NOT NULL,
	"opportunity_score" double precision,
	"confidence" text DEFAULT 'low' NOT NULL,
	"centroid_lat" double precision,
	"centroid_lng" double precision,
	"tile_q" integer,
	"tile_r" integer,
	"demo_fixture" boolean DEFAULT true NOT NULL,
	"source_snapshot_id" uuid,
	"listing_snapshot_id" uuid,
	CONSTRAINT "geo_signals_uq" UNIQUE("organization_id","zcta5","as_of_year")
);
--> statement-breakpoint
CREATE TABLE "inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"synthetic_demo" boolean DEFAULT true NOT NULL,
	"stage" "inquiry_stage" DEFAULT 'new' NOT NULL,
	"stage_entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contact_alias" text NOT NULL,
	"service_zip" text NOT NULL,
	"payer_id" uuid,
	"preferred_modes" text[] NOT NULL,
	"preferred_time_windows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requested_direct_hours" double precision,
	"intake_owner_id" uuid,
	"source_channel" text NOT NULL,
	"source_referral_code" text,
	"referral_code_id" uuid,
	"center_id" uuid,
	"import_source" text,
	"external_id" text,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "inquiries_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "inquiries_import_uq" UNIQUE("organization_id","import_source","external_id"),
	CONSTRAINT "inquiries_synthetic_only_ck" CHECK ("inquiries"."synthetic_demo" = true)
);
--> statement-breakpoint
CREATE TABLE "inquiry_center_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"inquiry_id" uuid NOT NULL,
	"center_id" uuid NOT NULL,
	"score" double precision,
	"eligible" text NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"capacity_snapshot_at" timestamp with time zone,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"selected_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inquiry_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"inquiry_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" uuid,
	"actor_source" text DEFAULT 'user' NOT NULL,
	"previous_stage" "inquiry_stage",
	"next_stage" "inquiry_stage",
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schema_version" smallint DEFAULT 1 NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inquiry_events_idem_uq" UNIQUE("organization_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "mission_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"mission_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"label" text NOT NULL,
	"numerator" double precision NOT NULL,
	"denominator" double precision,
	"time_range" text NOT NULL,
	"source_snapshot_id" uuid,
	"event_count" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "missions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"center_id" uuid,
	"category" text NOT NULL,
	"rule_id" text NOT NULL,
	"title" text NOT NULL,
	"explanation" text NOT NULL,
	"proposed_action" text NOT NULL,
	"guardrail" text NOT NULL,
	"expected_direction" text NOT NULL,
	"impact_score" double precision NOT NULL,
	"effort_score" double precision NOT NULL,
	"confidence_score" double precision NOT NULL,
	"priority_score" double precision NOT NULL,
	"requires_ops_review" boolean NOT NULL,
	"increases_demand" boolean DEFAULT false NOT NULL,
	"status" "mission_status" DEFAULT 'proposed' NOT NULL,
	"owner_id" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"draft_kinds" text[] DEFAULT '{}'::text[] NOT NULL,
	"experiment_template" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedupe_key" text NOT NULL,
	CONSTRAINT "missions_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "missions_dedupe_uq" UNIQUE("organization_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"industry" text DEFAULT 'ABA therapy' NOT NULL,
	"demo_mode" boolean DEFAULT true NOT NULL,
	"timezone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"seed_anchor_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"plan_name" text,
	CONSTRAINT "payers_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "payers_org_name_uq" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "referral_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"partner_id" uuid,
	"campaign_id" uuid,
	"center_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	CONSTRAINT "referral_codes_org_code_uq" UNIQUE("organization_id","code"),
	CONSTRAINT "referral_codes_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "referral_partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"business_name" text NOT NULL,
	"category" text NOT NULL,
	"public_contact_name" text,
	"public_contact_email" text,
	"source_url" text,
	"location" text,
	"zcta5" text,
	"relationship_status" text DEFAULT 'prospect' NOT NULL,
	"contact_permission_status" text DEFAULT 'not_requested' NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"demo_fixture" boolean DEFAULT true NOT NULL,
	CONSTRAINT "partners_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"url" text,
	"source_timestamp" timestamp with time zone,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dataset_version" text,
	"checksum" text,
	"status" text NOT NULL,
	"license_note" text,
	"parsing_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"demo_fixture" boolean DEFAULT true NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"triggered_by" uuid
);
--> statement-breakpoint
CREATE TABLE "staff_capacity_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"center_id" uuid NOT NULL,
	"role" "staff_role" NOT NULL,
	"day_of_week" smallint NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	"weekly_available_hours" double precision NOT NULL,
	"service_mode" text NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	CONSTRAINT "scw_day_ck" CHECK ("staff_capacity_windows"."day_of_week" between 0 and 6),
	CONSTRAINT "scw_minutes_ck" CHECK ("staff_capacity_windows"."start_minute" >= 0 and "staff_capacity_windows"."end_minute" <= 1440 and "staff_capacity_windows"."end_minute" > "staff_capacity_windows"."start_minute"),
	CONSTRAINT "scw_hours_ck" CHECK ("staff_capacity_windows"."weekly_available_hours" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid NOT NULL,
	"auth_user_id" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"display_name" text NOT NULL,
	CONSTRAINT "users_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_center_id_centers_organization_id_id_fk" FOREIGN KEY ("organization_id","center_id") REFERENCES "public"."centers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capacity_holds" ADD CONSTRAINT "capacity_holds_organization_id_inquiry_id_inquiries_organization_id_id_fk" FOREIGN KEY ("organization_id","inquiry_id") REFERENCES "public"."inquiries"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capacity_holds" ADD CONSTRAINT "capacity_holds_organization_id_center_id_centers_organization_id_id_fk" FOREIGN KEY ("organization_id","center_id") REFERENCES "public"."centers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capacity_rules" ADD CONSTRAINT "capacity_rules_organization_id_center_id_centers_organization_id_id_fk" FOREIGN KEY ("organization_id","center_id") REFERENCES "public"."centers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "center_payers" ADD CONSTRAINT "center_payers_organization_id_center_id_centers_organization_id_id_fk" FOREIGN KEY ("organization_id","center_id") REFERENCES "public"."centers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "center_payers" ADD CONSTRAINT "center_payers_organization_id_payer_id_payers_organization_id_id_fk" FOREIGN KEY ("organization_id","payer_id") REFERENCES "public"."payers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "centers" ADD CONSTRAINT "centers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_organization_id_mission_id_missions_organization_id_id_fk" FOREIGN KEY ("organization_id","mission_id") REFERENCES "public"."missions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_organization_id_center_id_centers_organization_id_id_fk" FOREIGN KEY ("organization_id","center_id") REFERENCES "public"."centers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_assignments" ADD CONSTRAINT "experiment_assignments_organization_id_experiment_id_experiments_organization_id_id_fk" FOREIGN KEY ("organization_id","experiment_id") REFERENCES "public"."experiments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_assignments" ADD CONSTRAINT "experiment_assignments_organization_id_variant_id_experiment_variants_organization_id_id_fk" FOREIGN KEY ("organization_id","variant_id") REFERENCES "public"."experiment_variants"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_variants" ADD CONSTRAINT "experiment_variants_organization_id_experiment_id_experiments_organization_id_id_fk" FOREIGN KEY ("organization_id","experiment_id") REFERENCES "public"."experiments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_organization_id_center_id_centers_organization_id_id_fk" FOREIGN KEY ("organization_id","center_id") REFERENCES "public"."centers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_organization_id_campaign_id_campaigns_organization_id_id_fk" FOREIGN KEY ("organization_id","campaign_id") REFERENCES "public"."campaigns"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_organization_id_mission_id_missions_organization_id_id_fk" FOREIGN KEY ("organization_id","mission_id") REFERENCES "public"."missions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_signals" ADD CONSTRAINT "geo_signals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_organization_id_center_id_centers_organization_id_id_fk" FOREIGN KEY ("organization_id","center_id") REFERENCES "public"."centers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_organization_id_payer_id_payers_organization_id_id_fk" FOREIGN KEY ("organization_id","payer_id") REFERENCES "public"."payers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_organization_id_referral_code_id_referral_codes_organization_id_id_fk" FOREIGN KEY ("organization_id","referral_code_id") REFERENCES "public"."referral_codes"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_center_matches" ADD CONSTRAINT "inquiry_center_matches_organization_id_inquiry_id_inquiries_organization_id_id_fk" FOREIGN KEY ("organization_id","inquiry_id") REFERENCES "public"."inquiries"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_center_matches" ADD CONSTRAINT "inquiry_center_matches_organization_id_center_id_centers_organization_id_id_fk" FOREIGN KEY ("organization_id","center_id") REFERENCES "public"."centers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_events" ADD CONSTRAINT "inquiry_events_organization_id_inquiry_id_inquiries_organization_id_id_fk" FOREIGN KEY ("organization_id","inquiry_id") REFERENCES "public"."inquiries"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_evidence" ADD CONSTRAINT "mission_evidence_organization_id_mission_id_missions_organization_id_id_fk" FOREIGN KEY ("organization_id","mission_id") REFERENCES "public"."missions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_organization_id_center_id_centers_organization_id_id_fk" FOREIGN KEY ("organization_id","center_id") REFERENCES "public"."centers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payers" ADD CONSTRAINT "payers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_organization_id_partner_id_referral_partners_organization_id_id_fk" FOREIGN KEY ("organization_id","partner_id") REFERENCES "public"."referral_partners"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_organization_id_campaign_id_campaigns_organization_id_id_fk" FOREIGN KEY ("organization_id","campaign_id") REFERENCES "public"."campaigns"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_partners" ADD CONSTRAINT "referral_partners_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_snapshots" ADD CONSTRAINT "source_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_capacity_windows" ADD CONSTRAINT "staff_capacity_windows_organization_id_center_id_centers_organization_id_id_fk" FOREIGN KEY ("organization_id","center_id") REFERENCES "public"."centers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_org_idx" ON "audit_logs" USING btree ("organization_id","event_time");--> statement-breakpoint
CREATE INDEX "capacity_rules_center_idx" ON "capacity_rules" USING btree ("organization_id","center_id");--> statement-breakpoint
CREATE INDEX "centers_org_idx" ON "centers" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "daily_metrics_org_idx" ON "daily_metrics" USING btree ("organization_id","day","metric_key");--> statement-breakpoint
CREATE INDEX "inquiries_org_created_idx" ON "inquiries" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "inquiries_org_stage_idx" ON "inquiries" USING btree ("organization_id","stage");--> statement-breakpoint
CREATE INDEX "inquiries_org_center_idx" ON "inquiries" USING btree ("organization_id","center_id");--> statement-breakpoint
CREATE INDEX "icm_inquiry_idx" ON "inquiry_center_matches" USING btree ("organization_id","inquiry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inquiry_events_one_created_uq" ON "inquiry_events" USING btree ("inquiry_id") WHERE event_type = 'inquiry_created';--> statement-breakpoint
CREATE UNIQUE INDEX "inquiry_events_one_start_uq" ON "inquiry_events" USING btree ("inquiry_id") WHERE event_type = 'care_started_verified_by_staff';--> statement-breakpoint
CREATE INDEX "inquiry_events_org_time_idx" ON "inquiry_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "inquiry_events_inquiry_idx" ON "inquiry_events" USING btree ("inquiry_id","occurred_at");--> statement-breakpoint
CREATE INDEX "inquiry_events_type_idx" ON "inquiry_events" USING btree ("organization_id","event_type");--> statement-breakpoint
CREATE INDEX "missions_org_status_idx" ON "missions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "partners_org_idx" ON "referral_partners" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "source_snapshots_org_idx" ON "source_snapshots" USING btree ("organization_id","source_key","ingested_at");--> statement-breakpoint
CREATE INDEX "scw_center_idx" ON "staff_capacity_windows" USING btree ("organization_id","center_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");