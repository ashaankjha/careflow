/**
 * CareFlow PostgreSQL schema (PRD §6). Every tenant-owned table carries
 * organization_id; child tables reference parents through composite
 * (organization_id, id) foreign keys so cross-tenant combinations are
 * impossible at the database level.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const base = {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
};

export const roleEnum = pgEnum("user_role", ["admin", "growth", "intake", "ops", "viewer"]);
export const stageEnum = pgEnum("inquiry_stage", [
  "new",
  "contacted",
  "qualified",
  "benefits_pending",
  "benefits_verified",
  "assessment_pending",
  "authorization_pending",
  "ready_to_start",
  "started",
  "waitlisted",
  "closed_unserviceable",
  "withdrawn",
  "inactive",
]);
export const payerStatusEnum = pgEnum("payer_status", ["verified_accepted", "not_accepted", "unknown"]);
export const staffRoleEnum = pgEnum("staff_role", ["RBT", "BCBA"]);
export const holdStatusEnum = pgEnum("hold_status", ["proposed", "reserved", "released"]);
export const campaignTypeEnum = pgEnum("campaign_type", ["SEO", "referral", "form_ux", "capacity_ops", "other"]);
export const campaignStatusEnum = pgEnum("campaign_status", ["draft", "approved", "active", "paused", "completed"]);
export const assignmentUnitEnum = pgEnum("assignment_unit", ["partner", "site_week", "page_session", "none"]);
export const designTypeEnum = pgEnum("design_type", ["randomized", "quasi_experimental", "observational"]);
export const experimentStatusEnum = pgEnum("experiment_status", ["draft", "active", "completed", "cancelled"]);
export const missionStatusEnum = pgEnum("mission_status", ["proposed", "approved", "rejected", "in_progress", "done"]);
export const draftKindEnum = pgEnum("draft_kind", ["seo_page", "partner_packet", "referral_email", "internal_plan"]);
export const approvalStatusEnum = pgEnum("approval_status", ["draft", "needs_review", "approved", "rejected"]);

// ---------------------------------------------------------------------------
export const organizations = pgTable("organizations", {
  ...base,
  name: text("name").notNull(),
  industry: text("industry").notNull().default("ABA therapy"),
  demoMode: boolean("demo_mode").notNull().default(true),
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  settings: jsonb("settings").notNull().default({}),
  seedAnchorAt: ts("seed_anchor_at"),
});

export const users = pgTable(
  "users",
  {
    ...base,
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    authUserId: text("auth_user_id").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: roleEnum("role").notNull(),
    displayName: text("display_name").notNull(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email), unique("users_org_id_uq").on(t.organizationId, t.id)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash)],
);

export const centers = pgTable(
  "centers",
  {
    ...base,
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    addressLine: text("address_line").notNull(),
    city: text("city").notNull(),
    state: text("state").notNull(),
    zip: text("zip").notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    serviceModes: text("service_modes").array().notNull(),
    serviceRadiusMiles: doublePrecision("service_radius_miles").notNull(),
    acceptedAgeMin: smallint("accepted_age_min"),
    acceptedAgeMax: smallint("accepted_age_max"),
    active: boolean("active").notNull().default(true),
    intakePhone: text("intake_phone").notNull(),
    intakeEmail: text("intake_email").notNull(),
    publicProfileStatus: text("public_profile_status").notNull().default("current"),
    capacityVersion: integer("capacity_version").notNull().default(0),
    capacityVerifiedAt: ts("capacity_verified_at"),
    capacityVerifiedBy: uuid("capacity_verified_by"),
    demoFixture: boolean("demo_fixture").notNull().default(true),
  },
  (t) => [unique("centers_org_id_uq").on(t.organizationId, t.id), index("centers_org_idx").on(t.organizationId, t.createdAt)],
);

export const payers = pgTable(
  "payers",
  {
    ...base,
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category"),
    planName: text("plan_name"),
  },
  (t) => [unique("payers_org_id_uq").on(t.organizationId, t.id), unique("payers_org_name_uq").on(t.organizationId, t.name)],
);

export const centerPayers = pgTable(
  "center_payers",
  {
    ...base,
    organizationId: uuid("organization_id").notNull(),
    centerId: uuid("center_id").notNull(),
    payerId: uuid("payer_id").notNull(),
    status: payerStatusEnum("status").notNull().default("unknown"),
    lastVerifiedAt: ts("last_verified_at"),
    verifiedBy: uuid("verified_by"),
    notes: text("notes"),
  },
  (t) => [
    unique("center_payers_uq").on(t.centerId, t.payerId),
    foreignKey({ columns: [t.organizationId, t.centerId], foreignColumns: [centers.organizationId, centers.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.organizationId, t.payerId], foreignColumns: [payers.organizationId, payers.id] }).onDelete("cascade"),
  ],
);

export const staffCapacityWindows = pgTable(
  "staff_capacity_windows",
  {
    ...base,
    organizationId: uuid("organization_id").notNull(),
    centerId: uuid("center_id").notNull(),
    role: staffRoleEnum("role").notNull(),
    dayOfWeek: smallint("day_of_week").notNull(),
    startMinute: smallint("start_minute").notNull(),
    endMinute: smallint("end_minute").notNull(),
    weeklyAvailableHours: doublePrecision("weekly_available_hours").notNull(),
    serviceMode: text("service_mode").notNull(),
    verifiedAt: ts("verified_at"),
    verifiedBy: uuid("verified_by"),
    effectiveFrom: ts("effective_from"),
    effectiveTo: ts("effective_to"),
  },
  (t) => [
    foreignKey({ columns: [t.organizationId, t.centerId], foreignColumns: [centers.organizationId, centers.id] }).onDelete("cascade"),
    index("scw_center_idx").on(t.organizationId, t.centerId),
    check("scw_day_ck", sql`${t.dayOfWeek} between 0 and 6`),
    check("scw_minutes_ck", sql`${t.startMinute} >= 0 and ${t.endMinute} <= 1440 and ${t.endMinute} > ${t.startMinute}`),
    check("scw_hours_ck", sql`${t.weeklyAvailableHours} >= 0`),
  ],
);

export const capacityRules = pgTable(
  "capacity_rules",
  {
    ...base,
    organizationId: uuid("organization_id").notNull(),
    centerId: uuid("center_id").notNull(),
    payerId: uuid("payer_id"),
    requiredBcbaHoursPerDirectHour: doublePrecision("required_bcba_hours_per_direct_hour"),
    minRbtCoverage: doublePrecision("min_rbt_coverage"),
    maxNewStartsPerWeek: integer("max_new_starts_per_week"),
    isVerified: boolean("is_verified").notNull().default(false),
  },
  (t) => [
    foreignKey({ columns: [t.organizationId, t.centerId], foreignColumns: [centers.organizationId, centers.id] }).onDelete("cascade"),
    index("capacity_rules_center_idx").on(t.organizationId, t.centerId),
  ],
);

export const referralPartners = pgTable(
  "referral_partners",
  {
    ...base,
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    businessName: text("business_name").notNull(),
    category: text("category").notNull(),
    publicContactName: text("public_contact_name"),
    publicContactEmail: text("public_contact_email"),
    sourceUrl: text("source_url"),
    location: text("location"),
    zcta5: text("zcta5"),
    relationshipStatus: text("relationship_status").notNull().default("prospect"),
    contactPermissionStatus: text("contact_permission_status").notNull().default("not_requested"),
    lastReviewedAt: ts("last_reviewed_at"),
    demoFixture: boolean("demo_fixture").notNull().default(true),
  },
  (t) => [unique("partners_org_id_uq").on(t.organizationId, t.id), index("partners_org_idx").on(t.organizationId, t.createdAt)],
);

export const campaigns = pgTable(
  "campaigns",
  {
    ...base,
    organizationId: uuid("organization_id").notNull(),
    name: text("name").notNull(),
    type: campaignTypeEnum("type").notNull(),
    centerId: uuid("center_id").notNull(),
    status: campaignStatusEnum("status").notNull().default("draft"),
    ownerUserId: uuid("owner_user_id"),
    budget: doublePrecision("budget"),
  },
  (t) => [
    unique("campaigns_org_id_uq").on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.centerId], foreignColumns: [centers.organizationId, centers.id] }).onDelete("cascade"),
  ],
);

export const referralCodes = pgTable(
  "referral_codes",
  {
    ...base,
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    partnerId: uuid("partner_id"),
    campaignId: uuid("campaign_id"),
    centerId: uuid("center_id"),
    status: text("status").notNull().default("active"),
    validFrom: ts("valid_from"),
    validTo: ts("valid_to"),
  },
  (t) => [
    unique("referral_codes_org_code_uq").on(t.organizationId, t.code),
    unique("referral_codes_org_id_uq").on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.partnerId], foreignColumns: [referralPartners.organizationId, referralPartners.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.organizationId, t.campaignId], foreignColumns: [campaigns.organizationId, campaigns.id] }),
  ],
);

export const inquiries = pgTable(
  "inquiries",
  {
    ...base,
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    syntheticDemo: boolean("synthetic_demo").notNull().default(true),
    stage: stageEnum("stage").notNull().default("new"),
    stageEnteredAt: ts("stage_entered_at").notNull().defaultNow(),
    contactAlias: text("contact_alias").notNull(),
    serviceZip: text("service_zip").notNull(),
    payerId: uuid("payer_id"),
    preferredModes: text("preferred_modes").array().notNull(),
    preferredTimeWindows: jsonb("preferred_time_windows").notNull().default([]),
    requestedDirectHours: doublePrecision("requested_direct_hours"),
    intakeOwnerId: uuid("intake_owner_id"),
    sourceChannel: text("source_channel").notNull(),
    sourceReferralCode: text("source_referral_code"),
    referralCodeId: uuid("referral_code_id"),
    centerId: uuid("center_id"),
    importSource: text("import_source"),
    externalId: text("external_id"),
    version: integer("version").notNull().default(0),
  },
  (t) => [
    unique("inquiries_org_id_uq").on(t.organizationId, t.id),
    unique("inquiries_import_uq").on(t.organizationId, t.importSource, t.externalId),
    foreignKey({ columns: [t.organizationId, t.centerId], foreignColumns: [centers.organizationId, centers.id] }),
    foreignKey({ columns: [t.organizationId, t.payerId], foreignColumns: [payers.organizationId, payers.id] }),
    foreignKey({ columns: [t.organizationId, t.referralCodeId], foreignColumns: [referralCodes.organizationId, referralCodes.id] }),
    index("inquiries_org_created_idx").on(t.organizationId, t.createdAt),
    index("inquiries_org_stage_idx").on(t.organizationId, t.stage),
    index("inquiries_org_center_idx").on(t.organizationId, t.centerId),
    // MVP is synthetic-only: the database refuses non-demo inquiry rows.
    check("inquiries_synthetic_only_ck", sql`${t.syntheticDemo} = true`),
  ],
);

export const inquiryEvents = pgTable(
  "inquiry_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    inquiryId: uuid("inquiry_id").notNull(),
    eventType: text("event_type").notNull(),
    actorUserId: uuid("actor_user_id"),
    actorSource: text("actor_source").notNull().default("user"),
    previousStage: stageEnum("previous_stage"),
    nextStage: stageEnum("next_stage"),
    occurredAt: ts("occurred_at").notNull(),
    recordedAt: ts("recorded_at").notNull().defaultNow(),
    metadata: jsonb("metadata").notNull().default({}),
    schemaVersion: smallint("schema_version").notNull().default(1),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.organizationId, t.inquiryId], foreignColumns: [inquiries.organizationId, inquiries.id] }).onDelete("cascade"),
    unique("inquiry_events_idem_uq").on(t.organizationId, t.idempotencyKey),
    uniqueIndex("inquiry_events_one_created_uq").on(t.inquiryId).where(sql`event_type = 'inquiry_created'`),
    uniqueIndex("inquiry_events_one_start_uq").on(t.inquiryId).where(sql`event_type = 'care_started_verified_by_staff'`),
    index("inquiry_events_org_time_idx").on(t.organizationId, t.occurredAt),
    index("inquiry_events_inquiry_idx").on(t.inquiryId, t.occurredAt),
    index("inquiry_events_type_idx").on(t.organizationId, t.eventType),
  ],
);

export const inquiryCenterMatches = pgTable(
  "inquiry_center_matches",
  {
    ...base,
    organizationId: uuid("organization_id").notNull(),
    inquiryId: uuid("inquiry_id").notNull(),
    centerId: uuid("center_id").notNull(),
    score: doublePrecision("score"),
    eligible: text("eligible").notNull(),
    reasons: jsonb("reasons").notNull().default([]),
    capacitySnapshotAt: ts("capacity_snapshot_at"),
    generatedAt: ts("generated_at").notNull().defaultNow(),
    selectedAt: ts("selected_at"),
  },
  (t) => [
    foreignKey({ columns: [t.organizationId, t.inquiryId], foreignColumns: [inquiries.organizationId, inquiries.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.organizationId, t.centerId], foreignColumns: [centers.organizationId, centers.id] }).onDelete("cascade"),
    index("icm_inquiry_idx").on(t.organizationId, t.inquiryId),
  ],
);

export const capacityHolds = pgTable(
  "capacity_holds",
  {
    ...base,
    organizationId: uuid("organization_id").notNull(),
    inquiryId: uuid("inquiry_id").notNull(),
    centerId: uuid("center_id").notNull(),
    directWeeklyHoursEstimate: doublePrecision("direct_weekly_hours_estimate").notNull(),
    bcbaWeeklyHoursEstimate: doublePrecision("bcba_weekly_hours_estimate").notNull(),
    status: holdStatusEnum("status").notNull().default("proposed"),
    expiresAt: ts("expires_at").notNull(),
    assignedBy: uuid("assigned_by"),
    /** Set when staff reserve verified capacity (locked transaction). Reserved is not an appointment. */
    reservedAt: ts("reserved_at"),
    releasedAt: ts("released_at"),
    releasedBy: uuid("released_by"),
    /** staff_released | expired | superseded */
    releaseReason: text("release_reason"),
  },
  (t) => [
    foreignKey({ columns: [t.organizationId, t.inquiryId], foreignColumns: [inquiries.organizationId, inquiries.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.organizationId, t.centerId], foreignColumns: [centers.organizationId, centers.id] }).onDelete("cascade"),
    uniqueIndex("capacity_holds_one_reserved_uq").on(t.inquiryId).where(sql`status = 'reserved'`),
    index("capacity_holds_center_idx").on(t.organizationId, t.centerId, t.status),
    check("capacity_holds_reserved_at_ck", sql`${t.status} <> 'reserved' or ${t.reservedAt} is not null`),
    check("capacity_holds_released_at_ck", sql`${t.status} <> 'released' or ${t.releasedAt} is not null`),
    check("capacity_holds_hours_ck", sql`${t.directWeeklyHoursEstimate} >= 0 and ${t.bcbaWeeklyHoursEstimate} >= 0`),
  ],
);

/**
 * Capacity history (risk R8). One immutable header per capacity save with the
 * rules snapshot; [valid_from, valid_to) is the period the sheet was in force.
 * valid_to is null for the current version.
 */
export const capacityVersions = pgTable(
  "capacity_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    centerId: uuid("center_id").notNull(),
    version: integer("version").notNull(),
    validFrom: ts("valid_from").notNull(),
    validTo: ts("valid_to"),
    rules: jsonb("rules").notNull().default([]),
    attested: boolean("attested").notNull().default(false),
    recordedBy: uuid("recorded_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("capacity_versions_org_id_uq").on(t.organizationId, t.id),
    unique("capacity_versions_center_version_uq").on(t.organizationId, t.centerId, t.version),
    foreignKey({ name: "capacity_versions_center_fk", columns: [t.organizationId, t.centerId], foreignColumns: [centers.organizationId, centers.id] }).onDelete("cascade"),
    uniqueIndex("capacity_versions_one_open_uq").on(t.centerId).where(sql`valid_to is null`),
    index("capacity_versions_center_idx").on(t.organizationId, t.centerId, t.validFrom),
    check("capacity_versions_range_ck", sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`),
  ],
);

/** Staff windows as recorded in a capacity version (append-only). */
export const staffCapacityWindowVersions = pgTable(
  "staff_capacity_window_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    centerId: uuid("center_id").notNull(),
    capacityVersionId: uuid("capacity_version_id").notNull(),
    role: staffRoleEnum("role").notNull(),
    dayOfWeek: smallint("day_of_week").notNull(),
    startMinute: smallint("start_minute").notNull(),
    endMinute: smallint("end_minute").notNull(),
    weeklyAvailableHours: doublePrecision("weekly_available_hours").notNull(),
    serviceMode: text("service_mode").notNull(),
    verifiedAt: ts("verified_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "scwv_version_fk", columns: [t.organizationId, t.capacityVersionId], foreignColumns: [capacityVersions.organizationId, capacityVersions.id] }).onDelete("cascade"),
    foreignKey({ name: "scwv_center_fk", columns: [t.organizationId, t.centerId], foreignColumns: [centers.organizationId, centers.id] }).onDelete("cascade"),
    index("scwv_version_idx").on(t.organizationId, t.capacityVersionId),
    check("scwv_day_ck", sql`${t.dayOfWeek} between 0 and 6`),
    check("scwv_minutes_ck", sql`${t.startMinute} >= 0 and ${t.endMinute} <= 1440 and ${t.endMinute} > ${t.startMinute}`),
    check("scwv_hours_ck", sql`${t.weeklyAvailableHours} >= 0`),
  ],
);

export const missions = pgTable(
  "missions",
  {
    ...base,
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    centerId: uuid("center_id"),
    category: text("category").notNull(),
    ruleId: text("rule_id").notNull(),
    title: text("title").notNull(),
    explanation: text("explanation").notNull(),
    proposedAction: text("proposed_action").notNull(),
    guardrail: text("guardrail").notNull(),
    expectedDirection: text("expected_direction").notNull(),
    impactScore: doublePrecision("impact_score").notNull(),
    effortScore: doublePrecision("effort_score").notNull(),
    confidenceScore: doublePrecision("confidence_score").notNull(),
    priorityScore: doublePrecision("priority_score").notNull(),
    requiresOpsReview: boolean("requires_ops_review").notNull(),
    increasesDemand: boolean("increases_demand").notNull().default(false),
    status: missionStatusEnum("status").notNull().default("proposed"),
    ownerId: uuid("owner_id"),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: ts("reviewed_at"),
    reviewNote: text("review_note"),
    draftKinds: text("draft_kinds").array().notNull().default(sql`'{}'::text[]`),
    experimentTemplate: jsonb("experiment_template").notNull().default({}),
    generatedAt: ts("generated_at").notNull().defaultNow(),
    dedupeKey: text("dedupe_key").notNull(),
  },
  (t) => [
    unique("missions_org_id_uq").on(t.organizationId, t.id),
    unique("missions_dedupe_uq").on(t.organizationId, t.dedupeKey),
    foreignKey({ columns: [t.organizationId, t.centerId], foreignColumns: [centers.organizationId, centers.id] }).onDelete("cascade"),
    index("missions_org_status_idx").on(t.organizationId, t.status),
  ],
);

export const missionEvidence = pgTable(
  "mission_evidence",
  {
    ...base,
    organizationId: uuid("organization_id").notNull(),
    missionId: uuid("mission_id").notNull(),
    metricKey: text("metric_key").notNull(),
    label: text("label").notNull(),
    numerator: doublePrecision("numerator").notNull(),
    denominator: doublePrecision("denominator"),
    timeRange: text("time_range").notNull(),
    sourceSnapshotId: uuid("source_snapshot_id"),
    eventCount: integer("event_count").notNull().default(0),
    verifiedAt: ts("verified_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.organizationId, t.missionId], foreignColumns: [missions.organizationId, missions.id] }).onDelete("cascade"),
  ],
);

export const contentDrafts = pgTable(
  "content_drafts",
  {
    ...base,
    organizationId: uuid("organization_id").notNull(),
    missionId: uuid("mission_id"),
    centerId: uuid("center_id").notNull(),
    partnerId: uuid("partner_id"),
    kind: draftKindEnum("kind").notNull(),
    locale: text("locale").notNull().default("en-US"),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull(),
    revision: integer("revision").notNull().default(1),
    approvalStatus: approvalStatusEnum("approval_status").notNull().default("draft"),
    validation: jsonb("validation").notNull().default({}),
    generator: text("generator").notNull().default("template"),
    reviewerId: uuid("reviewer_id"),
    approvedAt: ts("approved_at"),
    factsSnapshotAt: ts("facts_snapshot_at").notNull().defaultNow(),
  },
  (t) => [
    unique("drafts_org_id_uq").on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.missionId], foreignColumns: [missions.organizationId, missions.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.organizationId, t.centerId], foreignColumns: [centers.organizationId, centers.id] }).onDelete("cascade"),
  ],
);

export const experiments = pgTable(
  "experiments",
  {
    ...base,
    organizationId: uuid("organization_id").notNull(),
    campaignId: uuid("campaign_id"),
    missionId: uuid("mission_id"),
    centerId: uuid("center_id").notNull(),
    name: text("name").notNull(),
    hypothesis: text("hypothesis").notNull(),
    primaryMetric: text("primary_metric").notNull(),
    guardrailMetrics: jsonb("guardrail_metrics").notNull().default([]),
    assignmentUnit: assignmentUnitEnum("assignment_unit").notNull().default("none"),
    designType: designTypeEnum("design_type").notNull().default("observational"),
    status: experimentStatusEnum("status").notNull().default("draft"),
    baselineDays: integer("baseline_days").notNull().default(60),
    plannedDurationDays: integer("planned_duration_days").notNull().default(56),
    startedAt: ts("started_at"),
    endedAt: ts("ended_at"),
    ownerUserId: uuid("owner_user_id"),
    analysisNotes: text("analysis_notes"),
    simulated: boolean("simulated").notNull().default(true),
  },
  (t) => [
    unique("experiments_org_id_uq").on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.centerId], foreignColumns: [centers.organizationId, centers.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.organizationId, t.campaignId], foreignColumns: [campaigns.organizationId, campaigns.id] }),
    foreignKey({ columns: [t.organizationId, t.missionId], foreignColumns: [missions.organizationId, missions.id] }),
    check("experiments_none_not_randomized_ck", sql`not (${t.assignmentUnit} = 'none' and ${t.designType} = 'randomized')`),
  ],
);

export const experimentVariants = pgTable(
  "experiment_variants",
  {
    ...base,
    organizationId: uuid("organization_id").notNull(),
    experimentId: uuid("experiment_id").notNull(),
    key: text("key").notNull(),
    description: text("description").notNull(),
    allocationPct: doublePrecision("allocation_pct").notNull(),
  },
  (t) => [
    unique("variants_org_id_uq").on(t.organizationId, t.id),
    unique("variants_key_uq").on(t.experimentId, t.key),
    foreignKey({ columns: [t.organizationId, t.experimentId], foreignColumns: [experiments.organizationId, experiments.id] }).onDelete("cascade"),
  ],
);

export const experimentAssignments = pgTable(
  "experiment_assignments",
  {
    ...base,
    organizationId: uuid("organization_id").notNull(),
    experimentId: uuid("experiment_id").notNull(),
    unitHmac: text("unit_hmac").notNull(),
    variantId: uuid("variant_id").notNull(),
    /** Partner id for partner-level designs (a business, not a person); needed to attribute outcomes. */
    unitRef: uuid("unit_ref"),
    assignedAt: ts("assigned_at").notNull().defaultNow(),
  },
  (t) => [
    unique("assignments_unit_uq").on(t.experimentId, t.unitHmac),
    foreignKey({ columns: [t.organizationId, t.experimentId], foreignColumns: [experiments.organizationId, experiments.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.organizationId, t.variantId], foreignColumns: [experimentVariants.organizationId, experimentVariants.id] }).onDelete("cascade"),
  ],
);

export const sourceSnapshots = pgTable(
  "source_snapshots",
  {
    ...base,
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sourceKey: text("source_key").notNull(),
    url: text("url"),
    sourceTimestamp: ts("source_timestamp"),
    ingestedAt: ts("ingested_at").notNull().defaultNow(),
    datasetVersion: text("dataset_version"),
    checksum: text("checksum"),
    status: text("status").notNull(),
    licenseNote: text("license_note"),
    parsingWarnings: jsonb("parsing_warnings").notNull().default([]),
    demoFixture: boolean("demo_fixture").notNull().default(true),
    rowCount: integer("row_count").notNull().default(0),
    triggeredBy: uuid("triggered_by"),
  },
  (t) => [index("source_snapshots_org_idx").on(t.organizationId, t.sourceKey, t.ingestedAt)],
);

export const geoSignals = pgTable(
  "geo_signals",
  {
    ...base,
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    zcta5: text("zcta5").notNull(),
    label: text("label").notNull(),
    asOfYear: integer("as_of_year").notNull(),
    child014Est: integer("child_0_14_est"),
    child014Moe: integer("child_0_14_moe"),
    providerListingCount: integer("provider_listing_count"),
    internalInquiryCount: integer("internal_inquiry_count").notNull().default(0),
    opportunityScore: doublePrecision("opportunity_score"),
    confidence: text("confidence").notNull().default("low"),
    centroidLat: doublePrecision("centroid_lat"),
    centroidLng: doublePrecision("centroid_lng"),
    tileQ: integer("tile_q"),
    tileR: integer("tile_r"),
    demoFixture: boolean("demo_fixture").notNull().default(true),
    sourceSnapshotId: uuid("source_snapshot_id"),
    listingSnapshotId: uuid("listing_snapshot_id"),
  },
  (t) => [unique("geo_signals_uq").on(t.organizationId, t.zcta5, t.asOfYear)],
);

export const dailyMetrics = pgTable(
  "daily_metrics",
  {
    ...base,
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    centerId: uuid("center_id"),
    day: text("day").notNull(),
    metricKey: text("metric_key").notNull(),
    segmentKey: text("segment_key").notNull().default("all"),
    numerator: doublePrecision("numerator").notNull(),
    denominator: doublePrecision("denominator"),
    value: doublePrecision("value"),
    computedAt: ts("computed_at").notNull().defaultNow(),
    sourceRefreshAt: ts("source_refresh_at"),
  },
  (t) => [index("daily_metrics_org_idx").on(t.organizationId, t.day, t.metricKey)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id"),
    actorRole: text("actor_role"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    eventTime: ts("event_time").notNull().defaultNow(),
    allowed: boolean("allowed").notNull(),
    details: jsonb("details").notNull().default({}),
    requestId: text("request_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_logs_org_idx").on(t.organizationId, t.eventTime)],
);

/** Schema placeholder only (PRD §6.25). Not written to in the MVP. */
export const consentRecords = pgTable("consent_records", {
  ...base,
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(),
  channel: text("channel").notNull(),
  capturedTextVersion: text("captured_text_version").notNull(),
  lawfulBasis: text("lawful_basis").notNull(),
  optedOutAt: ts("opted_out_at"),
  enabled: boolean("enabled").notNull().default(false),
});

/**
 * Shared fixed-window rate-limit counters (migration 0002, UNLOGGED). Not tenant
 * data and not under RLS: keys are "<userId>:<r|w>" or "login:<ip>".
 */
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    key: text("key").primaryKey(),
    windowStart: ts("window_start").notNull(),
    hits: integer("hits").notNull(),
  },
  (t) => [index("rate_limit_buckets_window_idx").on(t.windowStart)],
);

/**
 * Per-account sign-in failure streaks (migration 0004, UNLOGGED). Not tenant
 * data and not under RLS; the app role has no direct privileges and goes
 * through SECURITY DEFINER functions. `accountKey` is the SHA-256 hex of the
 * normalized email, so no email address is stored.
 */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    accountKey: text("account_key").primaryKey(),
    failures: integer("failures").notNull(),
    firstFailureAt: ts("first_failure_at").notNull(),
    lockedUntil: ts("locked_until"),
  },
  (t) => [index("login_attempts_first_failure_idx").on(t.firstFailureAt)],
);
