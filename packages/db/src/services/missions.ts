import {
  generateMissionProposals,
  median,
  MISSION_STATUSES,
  type CenterSignals,
  type MissionProposal,
  type MissionStatus,
  type OrgSignals,
} from "@careflow/core";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db, Executor } from "../client";
import { centers, contentDrafts, dailyMetrics, experiments, missionEvidence, missions } from "../schema";
import { audit } from "./audit";
import { capacitySummaries } from "./capacity";
import { AppError, assertCan, nowOf, type Ctx } from "./context";
import { capacityFit, firstResponse, inquiriesCreated, stalls } from "./metrics";
import { getPolicy } from "./org";

const DAY = 86_400_000;

async function rows<T>(db: Executor, q: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(q)) as unknown as T[];
}

/** Assemble tenant-scoped aggregate signals for the deterministic rules. */
export async function buildMissionSignals(db: Executor, ctx: Ctx): Promise<{ centers: CenterSignals[]; org: OrgSignals }> {
  const policy = await getPolicy(db, ctx);
  const now = nowOf(ctx);
  const windowDays = policy.missions.recentWindowDays;
  const recent = { from: new Date(now.getTime() - windowDays * DAY), to: now };
  const cs = await db.select().from(centers).where(and(eq(centers.organizationId, ctx.orgId), eq(centers.active, true))).orderBy(asc(centers.id));
  const [caps, fit, stallRows] = await Promise.all([
    capacitySummaries(db, ctx),
    capacityFit(db, ctx, recent),
    stalls(db, ctx.orgId, {}, policy, now),
  ]);

  const perCenter = await Promise.all(
    cs.map(async (c) => {
      const f = { ...recent, centerId: c.id };
      const [created, fr] = await Promise.all([
        inquiriesCreated(db, ctx.orgId, f),
        firstResponse(db, ctx.orgId, f, policy.firstResponseSlaHours, now),
      ]);
      return { c, created, fr };
    }),
  );
  const peerMedian = median(perCenter.map((p) => p.created)) ?? 0;

  // Stage conversion with a fixed 14-day horizon so recent and baseline cohorts are comparable.
  const conv = await rows<{ center_id: string; stage: string; period: string; entered: number; advanced: number }>(
    db,
    sql`with entries as (
          select i.center_id, e.inquiry_id, e.next_stage::text as stage, e.occurred_at
          from inquiry_events e join inquiries i on i.id = e.inquiry_id and i.organization_id = e.organization_id
          where e.organization_id = ${ctx.orgId} and e.next_stage in ('contacted', 'qualified', 'benefits_verified')
            and e.occurred_at < ${new Date(now.getTime() - 14 * DAY)} and e.occurred_at >= ${new Date(now.getTime() - 90 * DAY)})
        select en.center_id, en.stage,
          case when en.occurred_at >= ${new Date(now.getTime() - 44 * DAY)} then 'recent' else 'baseline' end as period,
          count(*)::int as entered,
          count(*) filter (where exists (
            select 1 from inquiry_events n where n.organization_id = ${ctx.orgId} and n.inquiry_id = en.inquiry_id
              and n.previous_stage::text = en.stage and n.next_stage is not null
              and n.next_stage::text not in ('waitlisted','closed_unserviceable','withdrawn','inactive')
              and n.occurred_at <= en.occurred_at + interval '14 days'))::int as advanced
        from entries en group by 1, 2, 3`,
  );

  const partnerStarts = await rows<{ partner_id: string; partner_name: string; center_id: string | null; starts: number }>(
    db,
    sql`select rp.id as partner_id, rp.business_name as partner_name, i.center_id, count(distinct i.id)::int as starts
        from inquiries i
        join referral_codes rc on rc.id = i.referral_code_id and rc.organization_id = i.organization_id
        join referral_partners rp on rp.id = rc.partner_id and rp.organization_id = rc.organization_id
        join inquiry_events e on e.inquiry_id = i.id and e.organization_id = i.organization_id and e.event_type = 'care_started_verified_by_staff'
        where i.organization_id = ${ctx.orgId} and e.occurred_at >= ${new Date(now.getTime() - 90 * DAY)}
        group by 1, 2, 3`,
  );
  const partnerTotals = new Map<string, { partnerId: string; partnerName: string; starts: number }>();
  for (const p of partnerStarts) {
    const cur = partnerTotals.get(p.partner_id) ?? { partnerId: p.partner_id, partnerName: p.partner_name, starts: 0 };
    cur.starts += Number(p.starts);
    partnerTotals.set(p.partner_id, cur);
  }

  const centerSignals: CenterSignals[] = perCenter.map(({ c, created, fr }) => {
    const cap = caps.find((x) => x.centerId === c.id);
    const pc = fit.perCenter.get(c.id) ?? { evaluated: 0, notFeasibleAtCenter: 0, fitAnywhere: 0 };
    const bp = stallRows.filter((s) => s.centerId === c.id && s.stage === "benefits_pending");
    const stages = ["contacted", "qualified", "benefits_verified"].map((stage) => {
      const r = conv.find((x) => x.center_id === c.id && x.stage === stage && x.period === "recent");
      const b = conv.find((x) => x.center_id === c.id && x.stage === stage && x.period === "baseline");
      return {
        stage,
        recentEntered: Number(r?.entered ?? 0),
        recentAdvanced: Number(r?.advanced ?? 0),
        baselineEntered: Number(b?.entered ?? 0),
        baselineAdvanced: Number(b?.advanced ?? 0),
      };
    });
    return {
      centerId: c.id,
      centerName: c.name,
      windowDays,
      recentInquiries: created,
      peerMedianInquiries: peerMedian,
      verifiedHoursAvailable: cap?.hours ?? null,
      pendingHours: cap?.pendingHours ?? 0,
      matchEvaluated: pc.evaluated,
      matchNotFeasible: pc.notFeasibleAtCenter,
      slaEligible: fr.slaDenominator,
      slaMissed: fr.slaDenominator - fr.withinSla,
      benefitsPending: bp.reduce((s, x) => s + x.active, 0),
      benefitsStalled: bp.reduce((s, x) => s + x.stalled, 0),
      benefitsStallThresholdDays: policy.stallThresholdDays.benefits_pending ?? 10,
      stageConversion: stages,
      publicProfileStatus: (c.publicProfileStatus as CenterSignals["publicProfileStatus"]) ?? "current",
      partnerAttributedStarts: partnerStarts.filter((p) => p.center_id === c.id).reduce((s, p) => s + Number(p.starts), 0),
    };
  });
  const totals = [...partnerTotals.values()];
  return {
    centers: centerSignals,
    org: { partnerStarts: totals, totalPartnerAttributedStarts: totals.reduce((s, p) => s + p.starts, 0) },
  };
}

/** POST /missions/generate — run rules, persist with dedupe, save evidence + metric snapshots. */
export async function generateMissions(db: Db, ctx: Ctx) {
  assertCan(ctx, "mission:generate");
  const policy = await getPolicy(db, ctx);
  const now = nowOf(ctx);
  const signals = await buildMissionSignals(db, ctx);
  const proposals = generateMissionProposals(signals.centers, signals.org, policy, now);
  const result = { created: [] as string[], refreshed: [] as string[], unchanged: [] as string[], evaluatedCenters: signals.centers.length };

  await db.transaction(async (tx) => {
    for (const p of proposals) {
      let [existing] = await tx
        .select()
        .from(missions)
        .where(and(eq(missions.organizationId, ctx.orgId), eq(missions.dedupeKey, p.dedupeKey)));
      if (!existing) {
        // A still-unreviewed proposal for the same site + rule from an earlier reporting week is
        // refreshed (and re-keyed to this week) rather than duplicated. Reviewed missions do not block.
        [existing] = await tx
          .select()
          .from(missions)
          .where(
            and(
              eq(missions.organizationId, ctx.orgId),
              eq(missions.ruleId, p.ruleId),
              p.centerId ? eq(missions.centerId, p.centerId) : isNull(missions.centerId),
              eq(missions.status, "proposed"),
            ),
          )
          .orderBy(desc(missions.generatedAt))
          .limit(1);
      }
      let missionId: string;
      if (!existing) {
        const [m] = await tx
          .insert(missions)
          .values({ ...missionValues(p), organizationId: ctx.orgId, generatedAt: now, status: "proposed" })
          .returning({ id: missions.id });
        missionId = m!.id;
        result.created.push(missionId);
      } else if (existing.status === "proposed") {
        missionId = existing.id;
        await tx.update(missions).set({ ...missionValues(p), generatedAt: now, updatedAt: now }).where(eq(missions.id, existing.id));
        await tx.delete(missionEvidence).where(and(eq(missionEvidence.organizationId, ctx.orgId), eq(missionEvidence.missionId, existing.id)));
        result.refreshed.push(missionId);
      } else {
        result.unchanged.push(existing.id);
        continue; // reviewed missions keep their original evidence
      }
      await tx.insert(missionEvidence).values(
        p.evidence.map((e) => ({
          organizationId: ctx.orgId,
          missionId,
          metricKey: e.metricKey,
          label: e.label,
          numerator: e.numerator,
          denominator: e.denominator,
          timeRange: e.timeRange,
          eventCount: e.eventCount,
          verifiedAt: now,
        })),
      );
      await tx.insert(dailyMetrics).values(
        p.evidence.map((e) => ({
          organizationId: ctx.orgId,
          centerId: p.centerId,
          day: now.toISOString().slice(0, 10),
          metricKey: e.metricKey,
          segmentKey: `mission:${p.ruleId}`,
          numerator: e.numerator,
          denominator: e.denominator,
          value: e.denominator ? e.numerator / e.denominator : e.numerator,
          computedAt: now,
        })),
      );
    }
    await audit(tx, ctx, "missions.generate", "mission", null, true, {
      created: result.created.length,
      refreshed: result.refreshed.length,
      unchanged: result.unchanged.length,
    });
  });
  return { ...result, proposals: proposals.length, signals: signals.centers };
}

function missionValues(p: MissionProposal) {
  return {
    centerId: p.centerId,
    category: p.category,
    ruleId: p.ruleId,
    title: p.title,
    explanation: p.explanation,
    proposedAction: p.proposedAction,
    guardrail: p.guardrail,
    expectedDirection: p.expectedDirection,
    impactScore: p.impactScore,
    effortScore: p.effortScore,
    confidenceScore: p.confidenceScore,
    priorityScore: p.priorityScore,
    requiresOpsReview: p.requiresOpsReview,
    increasesDemand: p.increasesDemand,
    draftKinds: p.draftKinds,
    experimentTemplate: p.experiment,
    dedupeKey: p.dedupeKey,
  };
}

export async function listMissions(db: Executor, ctx: Ctx, opts: { status?: string; centerId?: string } = {}) {
  assertCan(ctx, "mission:read");
  const conds = [eq(missions.organizationId, ctx.orgId)];
  if (opts.status && (MISSION_STATUSES as readonly string[]).includes(opts.status)) conds.push(eq(missions.status, opts.status as MissionStatus));
  if (opts.centerId) conds.push(eq(missions.centerId, opts.centerId));
  const ms = await db
    .select({ m: missions, centerName: centers.name })
    .from(missions)
    .leftJoin(centers, and(eq(centers.id, missions.centerId), eq(centers.organizationId, missions.organizationId)))
    .where(and(...conds))
    .orderBy(
      sql`case ${missions.status} when 'proposed' then 0 when 'approved' then 1 when 'in_progress' then 2 when 'done' then 3 else 4 end`,
      desc(missions.priorityScore),
      asc(missions.id),
    );
  const ids = ms.map((x) => x.m.id);
  const [ev, drafts, exps] = ids.length
    ? await Promise.all([
        db.select().from(missionEvidence).where(and(eq(missionEvidence.organizationId, ctx.orgId), inArray(missionEvidence.missionId, ids))),
        db
          .select({
            id: contentDrafts.id,
            missionId: contentDrafts.missionId,
            kind: contentDrafts.kind,
            title: contentDrafts.title,
            approvalStatus: contentDrafts.approvalStatus,
            revision: contentDrafts.revision,
            locale: contentDrafts.locale,
          })
          .from(contentDrafts)
          .where(and(eq(contentDrafts.organizationId, ctx.orgId), inArray(contentDrafts.missionId, ids))),
        db
          .select({ id: experiments.id, missionId: experiments.missionId, name: experiments.name, status: experiments.status, designType: experiments.designType })
          .from(experiments)
          .where(and(eq(experiments.organizationId, ctx.orgId), inArray(experiments.missionId, ids))),
      ])
    : [[], [], []];
  return ms.map(({ m, centerName }) => ({
    ...m,
    centerName,
    evidence: ev.filter((e) => e.missionId === m.id),
    drafts: drafts.filter((d) => d.missionId === m.id),
    experiments: exps.filter((x) => x.missionId === m.id),
  }));
}

export async function getMission(db: Executor, ctx: Ctx, id: string) {
  assertCan(ctx, "mission:read");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("NOT_FOUND", "Mission not found");
  const [m] = await db.select().from(missions).where(and(eq(missions.organizationId, ctx.orgId), eq(missions.id, id)));
  if (!m) throw new AppError("NOT_FOUND", "Mission not found");
  const evidence = await db.select().from(missionEvidence).where(and(eq(missionEvidence.organizationId, ctx.orgId), eq(missionEvidence.missionId, id)));
  return { ...m, evidence };
}

export async function approveMission(db: Db, ctx: Ctx, id: string, note?: string) {
  const m = await getMission(db, ctx, id);
  assertCan(ctx, m.requiresOpsReview ? "mission:approve_ops_gated" : "mission:approve");
  if (m.status !== "proposed") throw new AppError("CONFLICT", `Mission is already ${m.status}`);
  if (m.increasesDemand && m.centerId) {
    // Re-check at approval time: capacity may have changed since generation.
    const policy = await getPolicy(db, ctx);
    const cap = (await capacitySummaries(db, ctx)).find((c) => c.centerId === m.centerId);
    if (!cap || cap.hours === null || cap.hours < policy.missions.m2MinVerifiedHours) {
      throw new AppError("CONFLICT", "Verified capacity at this site is no longer sufficient — demand-increasing missions cannot be approved");
    }
  }
  const now = nowOf(ctx);
  await db.transaction(async (tx) => {
    await tx
      .update(missions)
      .set({ status: "approved", reviewedBy: ctx.userId, reviewedAt: now, reviewNote: note ?? null, ownerId: m.ownerId ?? ctx.userId, updatedAt: now })
      .where(and(eq(missions.organizationId, ctx.orgId), eq(missions.id, id)));
    await audit(tx, ctx, "mission_approved", "mission", id, true, { ruleId: m.ruleId, opsGated: m.requiresOpsReview });
  });
  return getMission(db, ctx, id);
}

export async function rejectMission(db: Db, ctx: Ctx, id: string, note?: string) {
  assertCan(ctx, "mission:approve");
  const m = await getMission(db, ctx, id);
  if (m.status !== "proposed") throw new AppError("CONFLICT", `Mission is already ${m.status}`);
  const now = nowOf(ctx);
  await db
    .update(missions)
    .set({ status: "rejected", reviewedBy: ctx.userId, reviewedAt: now, reviewNote: note ?? null, updatedAt: now })
    .where(and(eq(missions.organizationId, ctx.orgId), eq(missions.id, id)));
  await audit(db, ctx, "mission_rejected", "mission", id, true, { ruleId: m.ruleId });
  return getMission(db, ctx, id);
}

export async function setMissionStatus(db: Db, ctx: Ctx, id: string, status: "in_progress" | "done") {
  assertCan(ctx, "mission:status");
  const m = await getMission(db, ctx, id);
  const allowed: Record<string, string[]> = { approved: ["in_progress", "done"], in_progress: ["done"] };
  if (!allowed[m.status]?.includes(status)) throw new AppError("INVALID_TRANSITION", `Cannot move mission from ${m.status} to ${status}`);
  await db.update(missions).set({ status, updatedAt: nowOf(ctx) }).where(and(eq(missions.organizationId, ctx.orgId), eq(missions.id, id)));
  await audit(db, ctx, `mission_${status}`, "mission", id, true);
  return getMission(db, ctx, id);
}
