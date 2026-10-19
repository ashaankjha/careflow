import { buildEquityReport, EQUITY_STEPS, type EquityGroupInput } from "@careflow/core";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Executor } from "../client";
import { centers } from "../schema";
import { AppError, assertCan, nowOf, type Ctx } from "./context";
import { getPolicy } from "./org";

const DAY = 86_400_000;

export const equityQuerySchema = z.object({
  days: z.coerce.number().int().min(30).max(365).default(90),
  centerId: z.string().uuid().nullable().optional(),
});

const NOT_RECORDED = "not_recorded";

function groupLabel(category: string): string {
  if (category === NOT_RECORDED) return "Payer not recorded";
  const words = category.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

type Row = {
  grp: string;
  n: number;
  sla_den: number;
  sla_num: number;
  matched: number;
  assessed: number;
  started: number;
};

/**
 * GET /equity — aggregate-only access rates per payer group for the inquiry
 * creation cohort in the window, with tenant small-cell suppression. Returns
 * counts only (no inquiry ids or aliases). Equity audit only: nothing here is
 * read by the matcher, missions, scoring or ranking.
 */
export async function equityAudit(db: Executor, ctx: Ctx, input: z.input<typeof equityQuerySchema> = {}) {
  assertCan(ctx, "equity:read");
  const q = equityQuerySchema.parse(input);
  const policy = await getPolicy(db, ctx);
  const now = nowOf(ctx);
  const to = now;
  const from = new Date(now.getTime() - q.days * DAY);
  let centerName: string | null = null;
  if (q.centerId) {
    const [c] = await db
      .select({ name: centers.name })
      .from(centers)
      .where(and(eq(centers.organizationId, ctx.orgId), eq(centers.id, q.centerId)));
    if (!c) throw new AppError("NOT_FOUND", "Center not found");
    centerName = c.name;
  }
  const centerCond = q.centerId ? sql`and i.center_id = ${q.centerId}` : sql``;
  const sla = policy.firstResponseSlaHours;
  const res = (await db.execute(
    sql`with c as (
          select coalesce(p.category, ${NOT_RECORDED}) grp, i.created_at,
            (select min(e.occurred_at) from inquiry_events e where e.organization_id = i.organization_id and e.inquiry_id = i.id
               and e.event_type = 'outreach_attempted' and e.occurred_at <= ${to}) fo,
            (exists (select 1 from inquiry_events e where e.organization_id = i.organization_id and e.inquiry_id = i.id
               and e.event_type = 'center_match_selected' and e.occurred_at <= ${to})
             or exists (select 1 from capacity_holds h where h.organization_id = i.organization_id and h.inquiry_id = i.id
               and h.status in ('proposed', 'reserved'))) matched,
            exists (select 1 from inquiry_events e where e.organization_id = i.organization_id and e.inquiry_id = i.id
               and e.event_type = 'assessment_scheduled_by_staff' and e.occurred_at <= ${to}) assessed,
            exists (select 1 from inquiry_events e where e.organization_id = i.organization_id and e.inquiry_id = i.id
               and e.event_type = 'care_started_verified_by_staff' and e.occurred_at <= ${to}) started
          from inquiries i
          left join payers p on p.organization_id = i.organization_id and p.id = i.payer_id
          where i.organization_id = ${ctx.orgId} ${centerCond} and i.created_at >= ${from} and i.created_at < ${to})
        select grp, count(*)::int n,
               count(*) filter (where fo is not null or ${to}::timestamptz - created_at > make_interval(hours => ${sla}))::int sla_den,
               count(*) filter (where fo is not null and fo - created_at <= make_interval(hours => ${sla}))::int sla_num,
               count(*) filter (where matched)::int matched,
               count(*) filter (where assessed)::int assessed,
               count(*) filter (where started)::int started
        from c group by grp order by grp`,
  )) as unknown as Row[];
  const groups: EquityGroupInput[] = res.map((r) => {
    const n = Number(r.n);
    return {
      key: r.grp,
      label: groupLabel(r.grp),
      inquiries: n,
      steps: {
        contact_within_sla: { numerator: Number(r.sla_num), denominator: Number(r.sla_den) },
        match_proposed: { numerator: Number(r.matched), denominator: n },
        assessment_scheduled: { numerator: Number(r.assessed), denominator: n },
        care_started: { numerator: Number(r.started), denominator: n },
      },
    };
  });
  const report = buildEquityReport(groups, policy.minCellSize);
  return {
    ...report,
    steps: EQUITY_STEPS,
    window: { from: from.toISOString(), to: to.toISOString(), days: q.days },
    centerId: q.centerId ?? null,
    centerName,
    grouping: "Payer category recorded on the inquiry (payer listings are not verified benefits)",
    slaHours: sla,
    cohortDefinition: "Inquiries created in the window; outcomes counted up to the report time (recent inquiries are right-censored).",
    caveats: [
      "Equity audit only — never used for scoring, ranking, matching or exclusion.",
      "Descriptive comparison: differences between payer groups may reflect payer-acceptance rules, benefits processes, site mix or referral patterns. Nothing here is causal.",
      `Small-cell suppression (tenant minimum ${report.minCellSize}): a cell is hidden when its denominator is below ${report.minCellSize} or when the people reaching — or not reaching — the step number 1–${report.minCellSize - 1}; complementary cells are hidden too so suppressed values cannot be derived from totals.`,
      "“Site match proposed” is a staff-selected site or a current proposed/reserved capacity hold — not an appointment.",
      "SIMULATED: synthetic demo data.",
    ],
  };
}
