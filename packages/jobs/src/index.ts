import { expireHolds, generateMissions, getDashboard, HARBOR, refreshMarket, userId, type Ctx, type Db } from "@careflow/db";
import { schema } from "@careflow/db";

/**
 * Cron-compatible job functions (PRD §5). In the MVP they run manually via the
 * CLI; a scheduler can call the same functions later without paid queue infra.
 */
export type Job = { name: string; schedule: string; description: string; run: (db: Db, ctx: Ctx) => Promise<unknown> };

export const JOBS: Job[] = [
  {
    name: "compute-daily-metrics",
    schedule: "15 2 * * *",
    description: "Snapshot derived KPIs per site into daily_metrics (derived, never source of truth)",
    run: async (db, ctx) => {
      const now = ctx.now ?? new Date();
      const f = { from: new Date(now.getTime() - 30 * 86_400_000), to: now };
      const d = await getDashboard(db, ctx, f);
      const day = now.toISOString().slice(0, 10);
      const rows = [
        ...Object.entries(d.kpis).map(([k, v]) => ({ centerId: null as string | null, metricKey: k, numerator: v.numerator ?? 0, denominator: v.denominator ?? null, value: v.value ?? null })),
        ...d.siteMatrix.flatMap((s) => [
          { centerId: s.centerId, metricKey: "inquiries_created", numerator: s.inquiries, denominator: null, value: s.inquiries },
          { centerId: s.centerId, metricKey: "care_starts", numerator: s.starts, denominator: null, value: s.starts },
          { centerId: s.centerId, metricKey: "verified_weekly_direct_hours_available", numerator: s.verifiedHours ?? 0, denominator: null, value: s.verifiedHours },
        ]),
      ];
      await db.insert(schema.dailyMetrics).values(rows.map((r) => ({ ...r, organizationId: ctx.orgId, day, segmentKey: "last_30d", computedAt: now })));
      return { rows: rows.length, day };
    },
  },
  { name: "generate-missions", schedule: "30 2 * * 1", description: "Evaluate deterministic mission rules (deduped per reporting week)", run: async (db, ctx) => {
    const r = await generateMissions(db, ctx);
    return { created: r.created.length, refreshed: r.refreshed.length, unchanged: r.unchanged.length };
  } },
  {
    name: "expire-holds",
    schedule: "*/15 * * * *",
    description: "Mark capacity holds past expires_at as released (capacity already ignores them at read time)",
    run: (db, ctx) => expireHolds(db, ctx),
  },
  { name: "refresh-market", schedule: "0 3 1 * *", description: "Public-data refresh with fixture fallback (ACS optional)", run: (db, ctx) => refreshMarket(db, ctx) },
];

export function systemCtx(orgId = HARBOR.id): Ctx {
  return { orgId, userId: userId("admin"), role: "admin", requestId: "job" };
}
