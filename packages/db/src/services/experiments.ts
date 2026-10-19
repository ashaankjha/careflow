import { analyzeExperiment, assignVariant, createExperimentSchema, type ArmOutcome } from "@careflow/core";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db, Executor } from "../client";
import {
  campaigns,
  centers,
  experimentAssignments,
  experimentVariants,
  experiments,
  missions,
  referralCodes,
  referralPartners,
} from "../schema";
import { audit } from "./audit";
import { AppError, assertCan, nowOf, type Ctx } from "./context";
import { getPolicy } from "./org";

const DAY = 86_400_000;

export function hmacSalt(): string {
  return process.env.EXPERIMENT_HMAC_SALT ?? "dev-only-change-me-experiment-salt";
}

const CAMPAIGN_TYPE: Record<string, "SEO" | "referral" | "form_ux" | "capacity_ops" | "other"> = {
  M1: "capacity_ops",
  M2: "referral",
  M3: "capacity_ops",
  M4: "capacity_ops",
  M5: "form_ux",
  M6: "referral",
  M7: "SEO",
};

export async function listExperiments(db: Executor, ctx: Ctx) {
  assertCan(ctx, "experiment:read");
  const exps = await db
    .select({ e: experiments, centerName: centers.name, missionTitle: missions.title })
    .from(experiments)
    .leftJoin(centers, and(eq(centers.id, experiments.centerId), eq(centers.organizationId, experiments.organizationId)))
    .leftJoin(missions, and(eq(missions.id, experiments.missionId), eq(missions.organizationId, experiments.organizationId)))
    .where(eq(experiments.organizationId, ctx.orgId))
    .orderBy(sql`case ${experiments.status} when 'active' then 0 when 'draft' then 1 when 'completed' then 2 else 3 end`, desc(experiments.createdAt));
  const ids = exps.map((x) => x.e.id);
  const [variants, counts] = ids.length
    ? await Promise.all([
        db.select().from(experimentVariants).where(and(eq(experimentVariants.organizationId, ctx.orgId), inArray(experimentVariants.experimentId, ids))),
        db
          .select({ experimentId: experimentAssignments.experimentId, n: sql<number>`count(*)::int` })
          .from(experimentAssignments)
          .where(and(eq(experimentAssignments.organizationId, ctx.orgId), inArray(experimentAssignments.experimentId, ids)))
          .groupBy(experimentAssignments.experimentId),
      ])
    : [[], []];
  return exps.map(({ e, centerName, missionTitle }) => ({
    ...e,
    centerName,
    missionTitle,
    variants: variants.filter((v) => v.experimentId === e.id).sort((a, b) => a.key.localeCompare(b.key)),
    assignmentCount: counts.find((c) => c.experimentId === e.id)?.n ?? 0,
  }));
}

export async function getExperiment(db: Executor, ctx: Ctx, id: string) {
  assertCan(ctx, "experiment:read");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("NOT_FOUND", "Experiment not found");
  const all = await listExperiments(db, ctx);
  const e = all.find((x) => x.id === id);
  if (!e) throw new AppError("NOT_FOUND", "Experiment not found");
  return e;
}

export async function createExperiment(db: Db, ctx: Ctx, input: z.input<typeof createExperimentSchema>) {
  assertCan(ctx, "experiment:manage");
  const data = createExperimentSchema.parse(input);
  const [c] = await db.select().from(centers).where(and(eq(centers.organizationId, ctx.orgId), eq(centers.id, data.centerId)));
  if (!c) throw new AppError("NOT_FOUND", "Center not found");
  let mission: typeof missions.$inferSelect | undefined;
  if (data.missionId) {
    [mission] = await db.select().from(missions).where(and(eq(missions.organizationId, ctx.orgId), eq(missions.id, data.missionId)));
    if (!mission) throw new AppError("NOT_FOUND", "Mission not found");
    if (!["approved", "in_progress"].includes(mission.status)) throw new AppError("CONFLICT", "Only approved missions can be connected to an experiment");
  }
  return db.transaction(async (tx) => {
    let campaignId: string | null = null;
    if (mission) {
      const [camp] = await tx
        .insert(campaigns)
        .values({
          organizationId: ctx.orgId,
          name: mission.title,
          type: CAMPAIGN_TYPE[mission.ruleId] ?? "other",
          centerId: data.centerId,
          status: "approved",
          ownerUserId: ctx.userId,
        })
        .returning({ id: campaigns.id });
      campaignId = camp!.id;
    }
    const [e] = await tx
      .insert(experiments)
      .values({
        organizationId: ctx.orgId,
        campaignId,
        missionId: data.missionId ?? null,
        centerId: data.centerId,
        name: data.name,
        hypothesis: data.hypothesis,
        primaryMetric: data.primaryMetric,
        guardrailMetrics: data.guardrailMetrics,
        assignmentUnit: data.assignmentUnit,
        designType: data.designType,
        baselineDays: data.baselineDays,
        plannedDurationDays: data.plannedDurationDays,
        status: "draft",
        ownerUserId: ctx.userId,
        simulated: true,
      })
      .returning();
    if (data.variants.length) {
      await tx.insert(experimentVariants).values(
        data.variants.map((v) => ({ organizationId: ctx.orgId, experimentId: e!.id, key: v.key, description: v.description, allocationPct: v.allocationPct })),
      );
    }
    await audit(tx, ctx, "experiment.create", "experiment", e!.id, true, { designType: data.designType, missionId: data.missionId ?? null });
    return e!;
  });
}

/** Start: randomized designs persist stable HMAC assignments before going active. */
export async function startExperiment(db: Db, ctx: Ctx, id: string) {
  assertCan(ctx, "experiment:manage");
  const e = await getExperiment(db, ctx, id);
  if (e.status !== "draft") throw new AppError("CONFLICT", `Experiment is ${e.status}`);
  const now = nowOf(ctx);
  await db.transaction(async (tx) => {
    if (e.designType === "randomized") {
      if (e.variants.length < 2) throw new AppError("VALIDATION_FAILED", "Randomized experiment needs variants");
      let units: { id: string; ref: string | null }[] = [];
      if (e.assignmentUnit === "partner") {
        const ps = await tx
          .select({ id: referralPartners.id })
          .from(referralPartners)
          .where(and(eq(referralPartners.organizationId, ctx.orgId), eq(referralPartners.relationshipStatus, "active"), eq(referralPartners.contactPermissionStatus, "granted")))
          .orderBy(asc(referralPartners.id));
        units = ps.map((p) => ({ id: p.id, ref: p.id }));
      } else if (e.assignmentUnit === "site_week") {
        const weeks = Math.ceil(e.plannedDurationDays / 7);
        units = Array.from({ length: weeks }, (_, i) => ({ id: `${e.centerId}:${new Date(now.getTime() + i * 7 * DAY).toISOString().slice(0, 10)}`, ref: null }));
      } else {
        throw new AppError("VALIDATION_FAILED", "page_session randomization requires first-party web instrumentation (not available in the MVP)");
      }
      if (units.length < 2) throw new AppError("VALIDATION_FAILED", "Not enough units to randomize");
      await tx.insert(experimentAssignments).values(
        units.map((u) => {
          const { variant, unitHash } = assignVariant(hmacSalt(), e.id, u.id, e.variants);
          return { organizationId: ctx.orgId, experimentId: e.id, unitHmac: unitHash, variantId: variant.id, unitRef: u.ref, assignedAt: now };
        }),
      );
    }
    await tx.update(experiments).set({ status: "active", startedAt: now, updatedAt: now }).where(eq(experiments.id, e.id));
    if (e.campaignId) await tx.update(campaigns).set({ status: "active", updatedAt: now }).where(eq(campaigns.id, e.campaignId));
    if (e.missionId) {
      await tx
        .update(missions)
        .set({ status: "in_progress", updatedAt: now })
        .where(and(eq(missions.organizationId, ctx.orgId), eq(missions.id, e.missionId), eq(missions.status, "approved")));
    }
    await audit(tx, ctx, "experiment_started", "experiment", e.id, true, { designType: e.designType, unit: e.assignmentUnit });
  });
  return getExperiment(db, ctx, id);
}

export async function completeExperiment(db: Db, ctx: Ctx, id: string, notes?: string) {
  assertCan(ctx, "experiment:manage");
  const e = await getExperiment(db, ctx, id);
  if (e.status !== "active") throw new AppError("CONFLICT", `Experiment is ${e.status}`);
  const now = nowOf(ctx);
  await db
    .update(experiments)
    .set({ status: "completed", endedAt: now, analysisNotes: notes ?? e.analysisNotes, updatedAt: now })
    .where(eq(experiments.id, e.id));
  if (e.campaignId) await db.update(campaigns).set({ status: "completed", updatedAt: now }).where(eq(campaigns.id, e.campaignId));
  await audit(db, ctx, "experiment_completed", "experiment", e.id, true);
  return getExperiment(db, ctx, id);
}

async function q<T>(db: Executor, s: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(s)) as unknown as T[];
}

async function windowOutcome(db: Executor, orgId: string, centerId: string, metric: string, from: Date, to: Date, slaHours: number, benefitsDays: number) {
  if (metric === "response_within_sla_rate") {
    const [r] = await q<{ den: number; succ: number }>(
      db,
      sql`with c as (select i.id, i.created_at, (select min(e.occurred_at) from inquiry_events e where e.organization_id = i.organization_id and e.inquiry_id = i.id and e.event_type = 'outreach_attempted') fo
                     from inquiries i where i.organization_id = ${orgId} and i.center_id = ${centerId} and i.created_at >= ${from} and i.created_at < ${to})
          select count(*) filter (where fo is not null or ${to}::timestamptz - created_at > make_interval(hours => ${slaHours}))::int den,
                 count(*) filter (where fo is not null and fo - created_at <= make_interval(hours => ${slaHours}))::int succ from c`,
    );
    return { denominator: Number(r?.den ?? 0), successes: Number(r?.succ ?? 0), unitLabel: "inquiries", successLabel: "contacted within SLA" };
  }
  if (metric.startsWith("median_days_in_benefits") || metric.startsWith("benefits")) {
    const [r] = await q<{ den: number; succ: number }>(
      db,
      sql`with en as (select e.inquiry_id, e.occurred_at from inquiry_events e join inquiries i on i.id = e.inquiry_id and i.organization_id = e.organization_id
                      where e.organization_id = ${orgId} and i.center_id = ${centerId} and e.next_stage = 'benefits_pending' and e.occurred_at >= ${from} and e.occurred_at < ${to})
          select count(*)::int den, count(*) filter (where exists (select 1 from inquiry_events v where v.organization_id = ${orgId} and v.inquiry_id = en.inquiry_id
                   and v.next_stage = 'benefits_verified' and v.occurred_at <= en.occurred_at + make_interval(days => ${benefitsDays})))::int succ from en`,
    );
    return { denominator: Number(r?.den ?? 0), successes: Number(r?.succ ?? 0), unitLabel: "benefits requests", successLabel: `verified within ${benefitsDays} days` };
  }
  const [r] = await q<{ den: number; succ: number }>(
    db,
    sql`select count(*)::int den, count(*) filter (where exists (select 1 from inquiry_events e where e.organization_id = i.organization_id and e.inquiry_id = i.id and e.event_type = 'care_started_verified_by_staff'))::int succ
        from inquiries i where i.organization_id = ${orgId} and i.center_id = ${centerId} and i.created_at >= ${from} and i.created_at < ${to}`,
  );
  return { denominator: Number(r?.den ?? 0), successes: Number(r?.succ ?? 0), unitLabel: "inquiries", successLabel: "verified care starts" };
}

async function guardrails(db: Executor, orgId: string, centerId: string | null, from: Date, to: Date) {
  const centerCond = centerId ? sql`and i.center_id = ${centerId}` : sql``;
  const [r] = await q<{ n: number; med_h: number | null; closed: number }>(
    db,
    sql`with c as (select i.id, i.created_at, i.stage,
                   (select min(e.occurred_at) from inquiry_events e where e.organization_id = i.organization_id and e.inquiry_id = i.id and e.event_type = 'outreach_attempted') fo
                   from inquiries i where i.organization_id = ${orgId} ${centerCond} and i.created_at >= ${from} and i.created_at < ${to})
        select count(*)::int n,
               percentile_cont(0.5) within group (order by extract(epoch from (fo - created_at)) / 3600.0) filter (where fo is not null) med_h,
               count(*) filter (where stage in ('closed_unserviceable', 'withdrawn', 'inactive'))::int closed from c`,
  );
  return {
    inquiries: Number(r?.n ?? 0),
    medianFirstResponseHours: r?.med_h == null ? null : Number(r.med_h),
    closeWithoutResolution: Number(r?.closed ?? 0),
  };
}

/** GET /experiments/:id/results — honest analysis with denominators, intervals only when eligible. */
export async function experimentResults(db: Executor, ctx: Ctx, id: string) {
  const e = await getExperiment(db, ctx, id);
  const policy = await getPolicy(db, ctx);
  const now = nowOf(ctx);
  const start = e.startedAt ?? now;
  const end = e.endedAt ?? now;
  const observationDays = Math.max(0, Math.round((end.getTime() - start.getTime()) / DAY));
  const [typical] = await q<{ d: number | null }>(
    db,
    sql`select percentile_cont(0.5) within group (order by extract(epoch from (e.occurred_at - i.created_at)) / 86400.0) d
        from inquiry_events e join inquiries i on i.id = e.inquiry_id and i.organization_id = e.organization_id
        where e.organization_id = ${ctx.orgId} and e.event_type = 'care_started_verified_by_staff'`,
  );
  const typicalDaysToStart = typical?.d == null ? null : Number(typical.d);
  let arms: ArmOutcome[] = [];
  let unitLabel = "inquiries";
  let successLabel = "verified care starts";
  let comparison = "";
  const notStarted = !e.startedAt;

  if (e.designType === "randomized" && e.assignmentUnit === "partner" && e.assignmentCount > 0) {
    comparison = "Intention-to-treat by randomized partner arm; outcomes counted per referred inquiry across all sites.";
    const assigned = await db
      .select({ variantId: experimentAssignments.variantId, partnerId: experimentAssignments.unitRef })
      .from(experimentAssignments)
      .where(and(eq(experimentAssignments.organizationId, ctx.orgId), eq(experimentAssignments.experimentId, e.id)));
    for (const v of e.variants) {
      const partnerIds = assigned.filter((a) => a.variantId === v.id && a.partnerId).map((a) => a.partnerId!);
      let den = 0;
      let succ = 0;
      if (partnerIds.length) {
        const codes = await db
          .select({ id: referralCodes.id })
          .from(referralCodes)
          .where(and(eq(referralCodes.organizationId, ctx.orgId), inArray(referralCodes.partnerId, partnerIds)));
        if (codes.length) {
          const [r] = await q<{ den: number; succ: number }>(
            db,
            sql`select count(*)::int den, count(*) filter (where exists (select 1 from inquiry_events e where e.organization_id = i.organization_id and e.inquiry_id = i.id and e.event_type = 'care_started_verified_by_staff'))::int succ
                from inquiries i where i.organization_id = ${ctx.orgId} and i.referral_code_id in (${sql.join(codes.map((c) => sql`${c.id}`), sql`, `)})
                  and i.created_at >= ${start} and i.created_at < ${end}`,
          );
          den = Number(r?.den ?? 0);
          succ = Number(r?.succ ?? 0);
        }
      }
      arms.push({ key: v.key, label: v.description, units: partnerIds.length, denominator: den, successes: succ });
    }
    unitLabel = "referred inquiries";
  } else {
    const baselineFrom = new Date(start.getTime() - e.baselineDays * DAY);
    const metric = e.primaryMetric;
    const base = await windowOutcome(db, ctx.orgId, e.centerId, metric, baselineFrom, start, policy.firstResponseSlaHours, policy.stallThresholdDays.benefits_pending ?? 10);
    const post = await windowOutcome(db, ctx.orgId, e.centerId, metric, start, end, policy.firstResponseSlaHours, policy.stallThresholdDays.benefits_pending ?? 10);
    unitLabel = base.unitLabel;
    successLabel = base.successLabel;
    comparison = `Before/after at ${e.centerName}: baseline ${e.baselineDays} days before start vs. ${observationDays} days since start.`;
    arms = [
      { key: "baseline", label: `Baseline (${e.baselineDays} d before start)`, units: 1, denominator: base.denominator, successes: base.successes },
      { key: "post", label: `Since start (${observationDays} d)`, units: 1, denominator: post.denominator, successes: post.successes },
    ];
  }
  const analysis = analyzeExperiment({
    designType: e.designType,
    hasPersistedAssignments: e.assignmentCount > 0,
    arms,
    minSamplePerArm: policy.experimentMinSamplePerArm,
    observationDays,
    typicalDaysToStart: successLabel === "verified care starts" ? typicalDaysToStart : null,
    simulated: e.simulated,
    assignmentUnit: e.assignmentUnit,
  });
  if (notStarted) analysis.caveats.unshift("Experiment has not started — no outcome window yet.");
  const baselineFrom = new Date(start.getTime() - e.baselineDays * DAY);
  const [gBase, gPost] = await Promise.all([
    guardrails(db, ctx.orgId, e.centerId, baselineFrom, start),
    guardrails(db, ctx.orgId, e.centerId, start, end),
  ]);
  return {
    experiment: e,
    randomized: e.designType === "randomized" && e.assignmentCount > 0,
    verificationSource: "CareFlow event log (staff-recorded administrative events)",
    dataVintage: now.toISOString(),
    simulated: e.simulated,
    unitLabel,
    successLabel,
    comparison,
    observationDays,
    typicalDaysToStart,
    analysis,
    guardrails: { baseline: gBase, post: gPost },
  };
}
