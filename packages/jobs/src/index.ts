import { expireHolds, generateMissions, getDashboard, refreshMarket, sql, withOrg, type Ctx, type Db } from "@careflow/db";
import { schema } from "@careflow/db";

/**
 * Cron-compatible job functions (PRD §5). In the MVP they run manually via the
 * CLI; a scheduler can call the same functions later without paid queue infra.
 *
 * Least privilege: `runJob` connects as the non-owner app role and runs a job
 * once per organization, each inside its own transaction with
 * `app.current_org` set (`withOrg`), so FORCEd RLS confines every read and
 * write to that organization. `db` handed to a job is that transaction.
 * No job needs owner rights.
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

/**
 * System actor for a job in one organization: admin-equivalent permissions, no
 * user id (audit rows show `actor_id = null`, `request_id = 'job'`).
 */
export function systemCtx(orgId: string, now?: Date): Ctx {
  return { orgId, userId: null, role: "admin", requestId: "job", ...(now ? { now } : {}) };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Organization ids via the SECURITY DEFINER `careflow_job_org_ids()` (migration
 * 0004): the only cross-tenant read the app role can make, and it returns ids only.
 */
export async function listJobOrgIds(db: Db): Promise<string[]> {
  const rows = (await db.execute(sql`select careflow_job_org_ids() as id`)) as unknown as { id: string }[];
  return rows.map((r) => r.id);
}

export type OrgRun = { orgId: string; ok: true; result: unknown } | { orgId: string; ok: false; error: string };

/**
 * Run `job` for `orgIds` (default: every organization) on an APP-ROLE pool, one
 * tenant-scoped transaction per organization. A failure in one organization is
 * reported and does not stop the others.
 */
export async function runJob(db: Db, job: Job, opts: { orgIds?: string[]; now?: Date } = {}): Promise<OrgRun[]> {
  const known = await listJobOrgIds(db);
  let orgIds = known;
  if (opts.orgIds) {
    for (const id of opts.orgIds) {
      if (!UUID_RE.test(id) || !known.includes(id.toLowerCase())) throw new Error(`Unknown organization id: ${id}`);
    }
    orgIds = opts.orgIds.map((id) => id.toLowerCase());
  }
  const out: OrgRun[] = [];
  for (const orgId of orgIds) {
    try {
      const result = await withOrg(db, orgId, (tx) => job.run(tx as unknown as Db, systemCtx(orgId, opts.now)));
      out.push({ orgId, ok: true, result });
    } catch (e) {
      out.push({ orgId, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
