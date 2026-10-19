import { contentProviderFromEnv, disabledDeliveryProvider, FeatureDisabled, type ContentDraftProvider } from "@careflow/connectors";
import { DRAFT_KINDS, DRAFT_LOCALES, haversineMiles, markdownToHtml, resolvePolicy, validateDraft, type DraftKind, type ServiceMode, type VerifiedFacts } from "@careflow/core";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db, Executor } from "../client";
import { centerPayers, centers, contentDrafts, geoSignals, organizations, payers, referralCodes, referralPartners } from "../schema";
import { audit } from "./audit";
import { capacitySummaries } from "./capacity";
import { AppError, assertCan, nowOf, type Ctx } from "./context";
import { getMission } from "./missions";

export const generateDraftSchema = z.object({
  missionId: z.string().uuid().nullable().optional(),
  centerId: z.string().uuid().optional(),
  partnerId: z.string().uuid().nullable().optional(),
  kind: z.enum(DRAFT_KINDS),
  locale: z.enum(DRAFT_LOCALES).default("en-US"),
});

export const updateDraftSchema = z.object({
  bodyMd: z.string().min(20).max(20_000),
  title: z.string().trim().min(3).max(200).optional(),
  revision: z.number().int().positive(),
});

/** Retrieve verified public org/center facts + aggregate evidence (never family-level data). */
export async function buildVerifiedFacts(db: Executor, ctx: Ctx, centerId: string, opts: { missionId?: string | null; partnerId?: string | null } = {}): Promise<VerifiedFacts> {
  const now = nowOf(ctx);
  const [org] = await db.select().from(organizations).where(eq(organizations.id, ctx.orgId));
  const [c] = await db.select().from(centers).where(and(eq(centers.organizationId, ctx.orgId), eq(centers.id, centerId)));
  if (!org || !c) throw new AppError("NOT_FOUND", "Center not found");
  const policy = resolvePolicy(org.settings);
  const cps = await db
    .select({ name: payers.name, status: centerPayers.status, lastVerifiedAt: centerPayers.lastVerifiedAt })
    .from(centerPayers)
    .innerJoin(payers, and(eq(payers.id, centerPayers.payerId), eq(payers.organizationId, centerPayers.organizationId)))
    .where(and(eq(centerPayers.organizationId, ctx.orgId), eq(centerPayers.centerId, centerId)))
    .orderBy(asc(payers.name));
  const allPayers = await db.select({ name: payers.name }).from(payers).where(eq(payers.organizationId, ctx.orgId));
  const fresh = (d: Date | null) => !!d && (now.getTime() - d.getTime()) / 86_400_000 <= policy.payerVerificationMaxAgeDays;
  const verifiedPayers = cps.filter((p) => p.status === "verified_accepted" && fresh(p.lastVerifiedAt));
  const verifiedNames = new Set(verifiedPayers.map((p) => p.name));
  const zctas = await db.select().from(geoSignals).where(eq(geoSignals.organizationId, ctx.orgId));
  const area =
    c.latitude != null && c.longitude != null
      ? zctas
          .filter((z) => z.centroidLat != null && haversineMiles({ lat: z.centroidLat!, lng: z.centroidLng! }, { lat: c.latitude!, lng: c.longitude! }) <= c.serviceRadiusMiles)
          .map((z) => z.zcta5)
          .sort()
      : [];
  const cap = (await capacitySummaries(db, ctx)).find((x) => x.centerId === centerId);
  let partnerName: string | null = null;
  let referralCode: string | null = null;
  if (opts.partnerId) {
    const [p] = await db.select().from(referralPartners).where(and(eq(referralPartners.organizationId, ctx.orgId), eq(referralPartners.id, opts.partnerId)));
    if (!p) throw new AppError("NOT_FOUND", "Partner not found");
    partnerName = p.businessName;
    const [rc] = await db
      .select()
      .from(referralCodes)
      .where(and(eq(referralCodes.organizationId, ctx.orgId), eq(referralCodes.partnerId, p.id), eq(referralCodes.status, "active")));
    referralCode = rc?.code ?? null;
  }
  let mission: VerifiedFacts["mission"] = null;
  if (opts.missionId) {
    const m = await getMission(db, ctx, opts.missionId);
    mission = {
      title: m.title,
      explanation: m.explanation,
      proposedAction: m.proposedAction,
      guardrail: m.guardrail,
      evidence: m.evidence.map((e) => ({
        metricKey: e.metricKey,
        label: e.label,
        numerator: e.numerator,
        denominator: e.denominator,
        timeRange: e.timeRange,
        eventCount: e.eventCount,
      })),
      experiment: m.experimentTemplate as { hypothesis: string; primaryMetric: string; guardrails: string[] },
    };
  }
  return {
    orgName: org.name,
    center: {
      name: c.name,
      addressLine: c.addressLine,
      city: c.city,
      state: c.state,
      zip: c.zip,
      serviceModes: c.serviceModes as ServiceMode[],
      serviceRadiusMiles: c.serviceRadiusMiles,
      acceptedAgeMin: c.acceptedAgeMin,
      acceptedAgeMax: c.acceptedAgeMax,
      intakePhone: c.intakePhone,
      intakeEmail: c.intakeEmail,
    },
    verifiedPayers: verifiedPayers.map((p) => ({ name: p.name, lastVerifiedAt: p.lastVerifiedAt!.toISOString() })),
    otherPayers: allPayers.map((p) => p.name).filter((n) => !verifiedNames.has(n)),
    verifiedHoursAvailable: cap?.hours ?? null,
    capacityVerifiedAt: c.capacityVerifiedAt?.toISOString() ?? null,
    serviceAreaZctas: area,
    referralCode,
    partnerName,
    mission,
  };
}

/** POST /drafts/generate — deterministic template by default; never auto-sends or publishes. */
export async function generateDraft(db: Db, ctx: Ctx, input: z.input<typeof generateDraftSchema>, provider: ContentDraftProvider = contentProviderFromEnv()) {
  assertCan(ctx, "draft:generate");
  const data = generateDraftSchema.parse(input);
  let centerId = data.centerId;
  if (data.missionId) {
    const m = await getMission(db, ctx, data.missionId);
    if (m.status !== "approved" && m.status !== "in_progress") {
      throw new AppError("CONFLICT", "Drafts can be generated only for approved missions");
    }
    centerId = m.centerId ?? centerId;
  }
  if (!centerId) throw new AppError("VALIDATION_FAILED", "centerId or missionId required");
  const facts = await buildVerifiedFacts(db, ctx, centerId, { missionId: data.missionId, partnerId: data.partnerId });
  const out = await provider.generate(data.kind as DraftKind, facts, data.locale);
  const validation = validateDraft(out.bodyMd, facts, data.kind);
  const [d] = await db
    .insert(contentDrafts)
    .values({
      organizationId: ctx.orgId,
      missionId: data.missionId ?? null,
      centerId,
      partnerId: data.partnerId ?? null,
      kind: data.kind,
      locale: data.locale,
      title: out.title,
      bodyMd: out.bodyMd,
      revision: 1,
      approvalStatus: validation.status === "pass" ? "draft" : "needs_review",
      validation,
      generator: out.generator,
      factsSnapshotAt: nowOf(ctx),
    })
    .returning();
  await audit(db, ctx, "draft.generate", "content_draft", d!.id, true, { kind: data.kind, locale: data.locale, generator: out.generator, validation: validation.status });
  return d!;
}

export async function getDraft(db: Executor, ctx: Ctx, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("NOT_FOUND", "Draft not found");
  const [d] = await db.select().from(contentDrafts).where(and(eq(contentDrafts.organizationId, ctx.orgId), eq(contentDrafts.id, id)));
  if (!d) throw new AppError("NOT_FOUND", "Draft not found");
  return d;
}

export async function listDrafts(db: Executor, ctx: Ctx) {
  assertCan(ctx, "mission:read");
  return db
    .select({
      id: contentDrafts.id,
      missionId: contentDrafts.missionId,
      centerId: contentDrafts.centerId,
      partnerId: contentDrafts.partnerId,
      kind: contentDrafts.kind,
      locale: contentDrafts.locale,
      title: contentDrafts.title,
      approvalStatus: contentDrafts.approvalStatus,
      revision: contentDrafts.revision,
      updatedAt: contentDrafts.updatedAt,
      approvedAt: contentDrafts.approvedAt,
    })
    .from(contentDrafts)
    .where(eq(contentDrafts.organizationId, ctx.orgId))
    .orderBy(desc(contentDrafts.updatedAt));
}

/** Human edits re-run the claim validator; approval is reset on any change. */
export async function updateDraft(db: Db, ctx: Ctx, id: string, input: z.input<typeof updateDraftSchema>) {
  assertCan(ctx, "draft:edit");
  const data = updateDraftSchema.parse(input);
  const d = await getDraft(db, ctx, id);
  if (d.revision !== data.revision) throw new AppError("CONFLICT", "Draft was edited by someone else — reload");
  const facts = await buildVerifiedFacts(db, ctx, d.centerId, { missionId: d.missionId, partnerId: d.partnerId });
  const validation = validateDraft(data.bodyMd, facts, d.kind);
  const [u] = await db
    .update(contentDrafts)
    .set({
      bodyMd: data.bodyMd,
      title: data.title ?? d.title,
      revision: d.revision + 1,
      approvalStatus: validation.status === "pass" ? "draft" : "needs_review",
      validation,
      approvedAt: null,
      reviewerId: null,
      updatedAt: nowOf(ctx),
      factsSnapshotAt: nowOf(ctx),
    })
    .where(and(eq(contentDrafts.organizationId, ctx.orgId), eq(contentDrafts.id, id)))
    .returning();
  await audit(db, ctx, "draft.edit", "content_draft", id, true, { revision: d.revision + 1, validation: validation.status });
  return u!;
}

/** Approve: re-validates against *current* verified records; unsupported claims block approval. */
export async function approveDraft(db: Db, ctx: Ctx, id: string) {
  assertCan(ctx, "draft:approve");
  const d = await getDraft(db, ctx, id);
  if (d.approvalStatus === "approved") return d;
  const facts = await buildVerifiedFacts(db, ctx, d.centerId, { missionId: d.missionId, partnerId: d.partnerId });
  const validation = validateDraft(d.bodyMd, facts, d.kind);
  if (validation.status !== "pass") {
    await db.update(contentDrafts).set({ validation, approvalStatus: "needs_review", updatedAt: nowOf(ctx) }).where(eq(contentDrafts.id, d.id));
    throw new AppError("VALIDATION_FAILED", "Draft contains claims that are not supported by verified records", validation);
  }
  const now = nowOf(ctx);
  const [u] = await db
    .update(contentDrafts)
    .set({ approvalStatus: "approved", reviewerId: ctx.userId, approvedAt: now, validation, updatedAt: now })
    .where(and(eq(contentDrafts.organizationId, ctx.orgId), eq(contentDrafts.id, id)))
    .returning();
  await audit(db, ctx, "draft.approve", "content_draft", id, true, { kind: d.kind, revision: d.revision });
  return u!;
}

/** Local preview export only (Markdown or HTML). Approved drafts only. */
export async function exportDraft(db: Executor, ctx: Ctx, id: string, format: "md" | "html") {
  assertCan(ctx, "draft:export");
  const d = await getDraft(db, ctx, id);
  if (d.approvalStatus !== "approved") throw new AppError("CONFLICT", "Only approved drafts can be exported for local preview");
  await audit(db, ctx, "draft.export", "content_draft", id, true, { format });
  const preview = disabledDeliveryProvider.preview({ title: d.title, bodyMd: d.bodyMd });
  return { draft: d, format, content: format === "md" ? d.bodyMd : markdownToHtml(d.bodyMd), channel: preview.channel };
}

/** Sending is disabled in the MVP — always throws FEATURE_DISABLED (and is audited). */
export async function sendDraft(db: Executor, ctx: Ctx, id: string): Promise<never> {
  const d = await getDraft(db, ctx, id);
  await audit(db, ctx, "draft.send_attempt", "content_draft", d.id, false, { reason: "feature_disabled" });
  try {
    return await disabledDeliveryProvider.send({ title: d.title, bodyMd: d.bodyMd });
  } catch (e) {
    if (e instanceof FeatureDisabled) throw new AppError("FEATURE_DISABLED", e.message);
    throw e;
  }
}

export { markdownToHtml };
