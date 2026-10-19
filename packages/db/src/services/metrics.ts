/**
 * Canonical KPI definitions (PRD §7) as SQL query functions over the
 * immutable event log. Each returns numerator + denominator so the UI can
 * label every number. See docs/metric-definitions.md.
 */
import {
  ACTIVE_STAGES,
  FUNNEL_STAGES,
  evaluateMatch,
  median,
  verifiedDirectHoursAvailable,
  type TenantPolicy,
} from "@careflow/core";
import { sql, type SQL } from "drizzle-orm";
import type { Executor } from "../client";
import { loadCapacityTimeline, loadMatchCenters } from "./capacity";
import { assertCan, nowOf, type Ctx } from "./context";
import { inquiryToMatchRequest } from "./matching";
import { getOrg, getPolicy } from "./org";

export type MetricFilters = { from: Date; to: Date; centerId?: string | null; source?: string | null };

type Row = Record<string, unknown>;
async function rows<T extends Row>(db: Executor, q: SQL): Promise<T[]> {
  const res = await db.execute(q);
  return res as unknown as T[];
}
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Shared inquiry-level filter (alias i). */
function inquiryFilter(orgId: string, f: Pick<MetricFilters, "centerId" | "source">): SQL {
  const parts: SQL[] = [sql`i.organization_id = ${orgId}`];
  if (f.centerId) parts.push(sql`i.center_id = ${f.centerId}`);
  if (f.source) parts.push(sql`i.source_channel = ${f.source}`);
  return sql.join(parts, sql` and `);
}

/** care_starts: distinct inquiries whose FIRST care_started_verified_by_staff falls in [from, to). */
export async function careStarts(db: Executor, orgId: string, f: MetricFilters) {
  const [r] = await rows<{ n: number }>(
    db,
    sql`select count(*)::int as n from (
          select e.inquiry_id, min(e.occurred_at) as first_start
          from inquiry_events e join inquiries i on i.id = e.inquiry_id and i.organization_id = e.organization_id
          where e.organization_id = ${orgId} and e.event_type = 'care_started_verified_by_staff' and ${inquiryFilter(orgId, f)}
          group by e.inquiry_id) s
        where s.first_start >= ${f.from} and s.first_start < ${f.to}`,
  );
  return num(r?.n);
}

/** inquiries_created: distinct inquiries created in [from, to). */
export async function inquiriesCreated(db: Executor, orgId: string, f: MetricFilters) {
  const [r] = await rows<{ n: number }>(
    db,
    sql`select count(*)::int as n from inquiries i where ${inquiryFilter(orgId, f)} and i.created_at >= ${f.from} and i.created_at < ${f.to}`,
  );
  return num(r?.n);
}

/** cohort_start_rate: creation cohort in window with a verified start by the reporting cutoff. */
export async function cohortStartRate(db: Executor, orgId: string, f: MetricFilters, cutoff: Date) {
  const [r] = await rows<{ cohort: number; started: number; young: number }>(
    db,
    sql`select count(*)::int as cohort,
               count(*) filter (where exists (
                 select 1 from inquiry_events e where e.organization_id = i.organization_id and e.inquiry_id = i.id
                   and e.event_type = 'care_started_verified_by_staff' and e.occurred_at <= ${cutoff}))::int as started,
               count(*) filter (where i.created_at > ${cutoff}::timestamptz - interval '45 days')::int as young
        from inquiries i
        where ${inquiryFilter(orgId, f)} and i.created_at >= ${f.from} and i.created_at < ${f.to}`,
  );
  const cohort = num(r?.cohort);
  return { numerator: num(r?.started), denominator: cohort, censoredYoung: num(r?.young), cutoff: cutoff.toISOString() };
}

/** median_first_response_hours plus SLA share and unanswered denominator. */
export async function firstResponse(db: Executor, orgId: string, f: MetricFilters, slaHours: number, now: Date) {
  const [r] = await rows<{
    cohort: number;
    answered: number;
    median_h: number | null;
    within_sla: number;
    overdue_unanswered: number;
  }>(
    db,
    sql`with c as (
          select i.id, i.created_at,
            (select min(e.occurred_at) from inquiry_events e where e.organization_id = i.organization_id and e.inquiry_id = i.id and e.event_type = 'outreach_attempted') as first_out
          from inquiries i where ${inquiryFilter(orgId, f)} and i.created_at >= ${f.from} and i.created_at < ${f.to})
        select count(*)::int as cohort,
               count(first_out)::int as answered,
               percentile_cont(0.5) within group (order by extract(epoch from (first_out - created_at)) / 3600.0) filter (where first_out is not null) as median_h,
               count(*) filter (where first_out is not null and first_out - created_at <= make_interval(hours => ${slaHours}))::int as within_sla,
               count(*) filter (where first_out is null and ${now}::timestamptz - created_at > make_interval(hours => ${slaHours}))::int as overdue_unanswered
        from c`,
  );
  const answered = num(r?.answered);
  const cohort = num(r?.cohort);
  const overdue = num(r?.overdue_unanswered);
  const slaDen = answered + overdue; // excludes young unanswered inquiries still inside the SLA window
  return {
    medianHours: numOrNull(r?.median_h),
    answered,
    unanswered: cohort - answered,
    cohort,
    withinSla: num(r?.within_sla),
    slaDenominator: slaDen,
  };
}

/** median_days_to_start among starts in window (n displayed). */
export async function daysToStart(db: Executor, orgId: string, f: MetricFilters) {
  const [r] = await rows<{ n: number; median_d: number | null }>(
    db,
    sql`select count(*)::int as n,
               percentile_cont(0.5) within group (order by extract(epoch from (s.first_start - i.created_at)) / 86400.0) as median_d
        from (select e.inquiry_id, min(e.occurred_at) first_start from inquiry_events e
              where e.organization_id = ${orgId} and e.event_type = 'care_started_verified_by_staff' group by e.inquiry_id) s
        join inquiries i on i.id = s.inquiry_id and i.organization_id = ${orgId}
        where ${inquiryFilter(orgId, f)} and s.first_start >= ${f.from} and s.first_start < ${f.to}`,
  );
  return { medianDays: numOrNull(r?.median_d), n: num(r?.n) };
}

/** stage_conversion for a creation cohort: distinct inquiries that ever reached each funnel stage. */
export async function stageFunnel(db: Executor, orgId: string, f: MetricFilters) {
  const res = await rows<{ stage: string; n: number }>(
    db,
    sql`select st.stage, count(distinct i.id)::int as n
        from inquiries i
        join lateral (
          select 'new'::text as stage
          union select e.next_stage::text from inquiry_events e
            where e.organization_id = i.organization_id and e.inquiry_id = i.id and e.next_stage is not null
        ) st on true
        where ${inquiryFilter(orgId, f)} and i.created_at >= ${f.from} and i.created_at < ${f.to}
        group by st.stage`,
  );
  const reached = new Map(res.map((r) => [r.stage, num(r.n)]));
  return FUNNEL_STAGES.map((stage, idx) => {
    const n = reached.get(stage) ?? 0;
    const next = FUNNEL_STAGES[idx + 1];
    const nextN = next ? (reached.get(next) ?? 0) : null;
    return { stage, reached: n, conversionToNext: next && n > 0 ? nextN! / n : null, nextStage: next ?? null };
  });
}

/** stall_rate snapshot: active inquiries older in stage than the configured threshold. */
export async function stalls(db: Executor, orgId: string, f: Pick<MetricFilters, "centerId" | "source">, policy: TenantPolicy, now: Date) {
  const res = await rows<{ stage: string; center_id: string | null; active: number; stalled: number }>(
    db,
    sql`select i.stage::text as stage, i.center_id, count(*)::int as active,
          count(*) filter (where ${now}::timestamptz - i.stage_entered_at > make_interval(days => coalesce((${JSON.stringify(policy.stallThresholdDays)}::jsonb ->> i.stage::text)::int, 7)))::int as stalled
        from inquiries i
        where ${inquiryFilter(orgId, f)} and i.stage::text in (${sql.join(ACTIVE_STAGES.map((s) => sql`${s}`), sql`, `)})
        group by i.stage, i.center_id`,
  );
  return res.map((r) => ({ stage: r.stage, centerId: r.center_id, active: num(r.active), stalled: num(r.stalled) }));
}

/** Weekly trend of inquiries created and verified starts (org timezone week buckets). */
export async function weeklyTrend(db: Executor, orgId: string, f: MetricFilters, tz: string) {
  const res = await rows<{ week: string; inquiries: number; starts: number }>(
    db,
    sql`with weeks as (
          select generate_series(date_trunc('week', ${f.from}::timestamptz at time zone ${tz}),
                                 date_trunc('week', (${f.to}::timestamptz - interval '1 second') at time zone ${tz}), interval '1 week') as week),
        inq as (select date_trunc('week', i.created_at at time zone ${tz}) as week, count(*)::int n from inquiries i
                where ${inquiryFilter(orgId, f)} and i.created_at >= ${f.from} and i.created_at < ${f.to} group by 1),
        st as (select date_trunc('week', s.first_start at time zone ${tz}) as week, count(*)::int n from (
                 select e.inquiry_id, min(e.occurred_at) first_start from inquiry_events e
                 join inquiries i on i.id = e.inquiry_id and i.organization_id = e.organization_id
                 where e.organization_id = ${orgId} and e.event_type = 'care_started_verified_by_staff' and ${inquiryFilter(orgId, f)}
                 group by e.inquiry_id) s where s.first_start >= ${f.from} and s.first_start < ${f.to} group by 1)
        select to_char(w.week, 'YYYY-MM-DD') as week, coalesce(inq.n, 0) as inquiries, coalesce(st.n, 0) as starts
        from weeks w left join inq on inq.week = w.week left join st on st.week = w.week order by w.week`,
  );
  return res.map((r) => ({ week: r.week, inquiries: num(r.inquiries), starts: num(r.starts) }));
}

/** referral_source_attribution: first-party codes with an explicit "unattributed" bucket. */
export async function referralAttribution(db: Executor, orgId: string, f: MetricFilters) {
  const res = await rows<{ code: string | null; partner: string | null; channel: string; inquiries: number; starts: number }>(
    db,
    sql`select rc.code, rp.business_name as partner, i.source_channel as channel, count(*)::int as inquiries,
          count(*) filter (where exists (select 1 from inquiry_events e where e.organization_id = i.organization_id and e.inquiry_id = i.id and e.event_type = 'care_started_verified_by_staff'))::int as starts
        from inquiries i
        left join referral_codes rc on rc.id = i.referral_code_id and rc.organization_id = i.organization_id
        left join referral_partners rp on rp.id = rc.partner_id and rp.organization_id = rc.organization_id
        where ${inquiryFilter(orgId, f)} and i.created_at >= ${f.from} and i.created_at < ${f.to}
        group by rc.code, rp.business_name, i.source_channel`,
  );
  const byCode = new Map<string, { code: string; partner: string; inquiries: number; starts: number }>();
  let unattributed = { inquiries: 0, starts: 0 };
  const byChannel = new Map<string, { inquiries: number; starts: number }>();
  for (const r of res) {
    const ch = byChannel.get(r.channel) ?? { inquiries: 0, starts: 0 };
    ch.inquiries += num(r.inquiries);
    ch.starts += num(r.starts);
    byChannel.set(r.channel, ch);
    if (!r.code) {
      unattributed = { inquiries: unattributed.inquiries + num(r.inquiries), starts: unattributed.starts + num(r.starts) };
      continue;
    }
    const cur = byCode.get(r.code) ?? { code: r.code, partner: r.partner ?? "Campaign code", inquiries: 0, starts: 0 };
    cur.inquiries += num(r.inquiries);
    cur.starts += num(r.starts);
    byCode.set(r.code, cur);
  }
  return {
    codes: [...byCode.values()].sort((a, b) => b.inquiries - a.inquiries || a.code.localeCompare(b.code)),
    unattributed,
    channels: [...byChannel.entries()].map(([channel, v]) => ({ channel, ...v })).sort((a, b) => b.inquiries - a.inquiries),
  };
}

/**
 * capacity_fit_rate: cohort inquiries with ≥1 verified potential fit / cohort
 * inquiries with required inputs. Each inquiry is evaluated AS OF its creation
 * time: the capacity version in force then (windows, rules, verification
 * timestamps), the holds active then and verified starts in the 7 days before.
 * Missing-data rate and inquiries with no capacity version in force are reported
 * separately. `capacityDetail` (verified hours available now) uses current capacity.
 */
export async function capacityFit(db: Executor, ctx: Ctx, f: MetricFilters) {
  const policy = await getPolicy(db, ctx);
  const [centersData, timeline] = await Promise.all([loadMatchCenters(db, ctx), loadCapacityTimeline(db, ctx)]);
  const zctas = await rows<{ zcta5: string; lat: number; lng: number }>(
    db,
    sql`select distinct on (zcta5) zcta5, centroid_lat as lat, centroid_lng as lng from geo_signals where organization_id = ${ctx.orgId} order by zcta5, as_of_year desc`,
  );
  const zmap = new Map(zctas.map((z) => [z.zcta5, z.lat != null ? { lat: Number(z.lat), lng: Number(z.lng) } : null]));
  const cohort = await rows<{
    id: string;
    center_id: string | null;
    service_zip: string;
    payer_id: string | null;
    preferred_modes: string[];
    preferred_time_windows: unknown;
    requested_direct_hours: number | null;
    created_at: Date | string;
  }>(
    db,
    sql`select i.id, i.center_id, i.service_zip, i.payer_id, i.preferred_modes, i.preferred_time_windows, i.requested_direct_hours, i.created_at
        from inquiries i where ${inquiryFilter(ctx.orgId, f)} and i.created_at >= ${f.from} and i.created_at < ${f.to}`,
  );
  const now = nowOf(ctx);
  let withInputs = 0;
  let fit = 0;
  let withoutVersion = 0;
  const perCenter = new Map<string, { evaluated: number; notFeasibleAtCenter: number; fitAnywhere: number }>();
  for (const q of cohort) {
    const windows = (q.preferred_time_windows as unknown[]) ?? [];
    const hasInputs = !!q.payer_id && windows.length > 0 && q.preferred_modes.length > 0 && zmap.has(q.service_zip);
    if (!hasInputs) continue;
    withInputs++;
    const req = inquiryToMatchRequest({
      serviceZip: q.service_zip,
      payerId: q.payer_id,
      preferredModes: q.preferred_modes,
      preferredTimeWindows: windows,
      requestedDirectHours: q.requested_direct_hours,
    });
    const asOf = new Date(q.created_at);
    if (!timeline.covered(asOf)) withoutVersion++;
    const res = evaluateMatch(req, timeline.at(asOf), { now: asOf, policy, zcta: zmap.get(q.service_zip) ?? null });
    const anyFit = res.status === "potential_fit";
    if (anyFit) fit++;
    if (q.center_id) {
      const pc = perCenter.get(q.center_id) ?? { evaluated: 0, notFeasibleAtCenter: 0, fitAnywhere: 0 };
      pc.evaluated++;
      const atCenter = res.matches.find((m) => m.centerId === q.center_id);
      if (atCenter && atCenter.eligibility === "not_feasible") pc.notFeasibleAtCenter++;
      if (anyFit) pc.fitAnywhere++;
      perCenter.set(q.center_id, pc);
    }
  }
  return {
    numerator: fit,
    denominator: withInputs,
    missingInputs: cohort.length - withInputs,
    cohort: cohort.length,
    withoutCapacityVersion: withoutVersion,
    perCenter,
    capacityDetail: centersData.map((c) => ({ centerId: c.id, ...verifiedDirectHoursAvailable(c, { now, policy }) })),
  };
}

export type DashboardResult = Awaited<ReturnType<typeof getDashboard>>;

/** GET /dashboard — all KPIs share the same filters so numerators and denominators move together. */
export async function getDashboard(db: Executor, ctx: Ctx, f: MetricFilters) {
  assertCan(ctx, "dashboard:read");
  const org = await getOrg(db, ctx);
  const policy = await getPolicy(db, ctx);
  const now = nowOf(ctx);
  const cutoff = f.to < now ? f.to : now;
  const [starts, created, cohort, fr, dts, funnel, stallRows, trend, attribution, fit, centersList, lastRefresh] = await Promise.all([
    careStarts(db, ctx.orgId, f),
    inquiriesCreated(db, ctx.orgId, f),
    cohortStartRate(db, ctx.orgId, f, cutoff),
    firstResponse(db, ctx.orgId, f, policy.firstResponseSlaHours, now),
    daysToStart(db, ctx.orgId, f),
    stageFunnel(db, ctx.orgId, f),
    stalls(db, ctx.orgId, f, policy, now),
    weeklyTrend(db, ctx.orgId, f, org.timezone),
    referralAttribution(db, ctx.orgId, f),
    capacityFit(db, ctx, f),
    rows<{ id: string; name: string; public_profile_status: string }>(
      db,
      sql`select id, name, public_profile_status from centers where organization_id = ${ctx.orgId} order by name`,
    ),
    rows<{ source_key: string; ingested_at: Date; status: string; demo_fixture: boolean; dataset_version: string | null }>(
      db,
      sql`select distinct on (source_key) source_key, ingested_at, status, demo_fixture, dataset_version from source_snapshots
          where organization_id = ${ctx.orgId} order by source_key, ingested_at desc`,
    ),
  ]);
  const lastEvent = await rows<{ t: Date | null }>(db, sql`select max(recorded_at) as t from inquiry_events where organization_id = ${ctx.orgId}`);

  // Site matrix (each site with its own filters; source filter still applies)
  const siteMatrix = await Promise.all(
    centersList
      .filter((c) => !f.centerId || c.id === f.centerId)
      .map(async (c) => {
        const sf = { ...f, centerId: c.id };
        const [sCreated, sStarts, sCohort, sFr] = await Promise.all([
          inquiriesCreated(db, ctx.orgId, sf),
          careStarts(db, ctx.orgId, sf),
          cohortStartRate(db, ctx.orgId, sf, cutoff),
          firstResponse(db, ctx.orgId, sf, policy.firstResponseSlaHours, now),
        ]);
        const cap = fit.capacityDetail.find((d) => d.centerId === c.id);
        const pc = fit.perCenter.get(c.id) ?? { evaluated: 0, notFeasibleAtCenter: 0, fitAnywhere: 0 };
        const siteStalls = stallRows.filter((s) => s.centerId === c.id);
        const stalled = siteStalls.reduce((s, x) => s + x.stalled, 0);
        const benefitsStalled = siteStalls.find((s) => s.stage === "benefits_pending")?.stalled ?? 0;
        const benefitsActive = siteStalls.find((s) => s.stage === "benefits_pending")?.active ?? 0;
        const slaMissShare = sFr.slaDenominator ? 1 - sFr.withinSla / sFr.slaDenominator : null;
        const notFeasibleShare = pc.evaluated ? pc.notFeasibleAtCenter / pc.evaluated : null;
        const flags: { key: string; label: string; tone: "red" | "amber" | "blue" }[] = [];
        if ((cap?.hours ?? 0) < policy.missions.m1MaxVerifiedHours && sCreated >= policy.missions.m1MinInquiries)
          flags.push({ key: "capacity", label: "Demand exceeds verified capacity", tone: "red" });
        if (benefitsStalled >= policy.missions.m4MinStalled)
          flags.push({ key: "benefits", label: "Benefits verification stalls", tone: "amber" });
        if (slaMissShare !== null && slaMissShare > policy.missions.m3SlaMissShare && sFr.slaDenominator >= policy.missions.m3MinN)
          flags.push({ key: "sla", label: "First-response SLA misses", tone: "amber" });
        if ((cap?.hours ?? 0) >= policy.missions.m2MinVerifiedHours)
          flags.push({ key: "headroom", label: "Verified capacity available", tone: "blue" });
        if ((cap?.pendingHours ?? 0) > 0 && cap?.hours !== null)
          flags.push({ key: "pending", label: `${cap?.pendingHours} h pending ops verification`, tone: "blue" });
        return {
          centerId: c.id,
          centerName: c.name,
          inquiries: sCreated,
          starts: sStarts,
          cohortStarted: sCohort.numerator,
          cohortSize: sCohort.denominator,
          verifiedHours: cap?.hours ?? null,
          pendingHours: cap?.pendingHours ?? 0,
          capacityReason: cap?.reason ?? "",
          evaluated: pc.evaluated,
          notFeasibleAtSite: pc.notFeasibleAtCenter,
          notFeasibleShare,
          stalled,
          benefitsStalled,
          benefitsActive,
          slaMissShare,
          slaDenominator: sFr.slaDenominator,
          flags,
        };
      }),
  );

  const totalStalled = stallRows.reduce((s, x) => s + x.stalled, 0);
  const totalActive = stallRows.reduce((s, x) => s + x.active, 0);
  const stallByStage = ACTIVE_STAGES.map((stage) => ({
    stage,
    active: stallRows.filter((s) => s.stage === stage).reduce((a, x) => a + x.active, 0),
    stalled: stallRows.filter((s) => s.stage === stage).reduce((a, x) => a + x.stalled, 0),
    thresholdDays: policy.stallThresholdDays[stage] ?? 7,
  }));

  return {
    filters: { from: f.from.toISOString(), to: f.to.toISOString(), centerId: f.centerId ?? null, source: f.source ?? null },
    generatedAt: now.toISOString(),
    demoMode: org.demoMode,
    kpis: {
      care_starts: { value: starts, numerator: starts, denominator: null },
      inquiries_created: { value: created, numerator: created, denominator: null },
      cohort_start_rate: {
        value: cohort.denominator ? cohort.numerator / cohort.denominator : null,
        numerator: cohort.numerator,
        denominator: cohort.denominator,
        cutoff: cohort.cutoff,
        censoredYoung: cohort.censoredYoung,
      },
      median_first_response_hours: {
        value: fr.medianHours,
        numerator: fr.answered,
        denominator: fr.cohort,
        unanswered: fr.unanswered,
        withinSla: fr.withinSla,
        slaDenominator: fr.slaDenominator,
        slaHours: policy.firstResponseSlaHours,
      },
      median_days_to_start: { value: dts.medianDays, numerator: dts.n, denominator: null, n: dts.n },
      capacity_fit_rate: {
        value: fit.denominator ? fit.numerator / fit.denominator : null,
        numerator: fit.numerator,
        denominator: fit.denominator,
        missingInputs: fit.missingInputs,
        cohort: fit.cohort,
        asOf: "inquiry_created_at" as const,
        withoutCapacityVersion: fit.withoutCapacityVersion,
      },
      unresolved_stalls: { value: totalStalled, numerator: totalStalled, denominator: totalActive },
    },
    funnel,
    stallByStage,
    trend,
    siteMatrix,
    attribution,
    provenance: {
      lastEventRecordedAt: lastEvent[0]?.t ? new Date(lastEvent[0].t).toISOString() : null,
      capacityEvaluatedAt: now.toISOString(),
      sources: lastRefresh.map((s) => ({
        sourceKey: s.source_key,
        ingestedAt: new Date(s.ingested_at).toISOString(),
        status: s.status,
        demoFixture: s.demo_fixture,
        datasetVersion: s.dataset_version,
      })),
    },
  };
}

export { median };
