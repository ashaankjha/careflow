import { createDb, HARBOR, LAKESIDE, seedDatabase, sql, type Db } from "@careflow/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { JOBS, listJobOrgIds, runJob, type Job } from "../src/index";

/**
 * Jobs run as the least-privilege `careflow_app` role, one tenant-scoped
 * transaction per organization (migration 0004). The owner connection only
 * seeds and inspects.
 */
const ANCHOR = new Date("2026-10-01T18:00:00Z");
const owner = createDb(process.env.TEST_DATABASE_URL!, { max: 2 });
const app = createDb(process.env.TEST_APP_DATABASE_URL!, { max: 2 });
afterAll(async () => {
  await Promise.all([owner.client.end(), app.client.end()]);
});
beforeEach(async () => {
  await seedDatabase(owner.db, { now: ANCHOR });
});

type Row = Record<string, unknown>;
const q = async (db: Db, query: ReturnType<typeof sql>) => (await db.execute(query)) as unknown as Row[];
const job = (name: string) => JOBS.find((j) => j.name === name)!;

/** One expired proposed hold in each organization (Harbor's seeded holds plus one added for Lakeside). */
async function expireAllHolds() {
  await owner.db.execute(sql`update capacity_holds set expires_at = ${new Date(ANCHOR.getTime() - 3_600_000)} where status = 'proposed'`);
  await owner.db.execute(sql`
    insert into capacity_holds (organization_id, inquiry_id, center_id, direct_weekly_hours_estimate, bcba_weekly_hours_estimate, status, expires_at)
    select ${LAKESIDE.id}::uuid, (select id from inquiries where organization_id = ${LAKESIDE.id} order by id limit 1),
           (select id from centers where organization_id = ${LAKESIDE.id} order by id limit 1), 5, 1, 'proposed', ${new Date(ANCHOR.getTime() - 3_600_000)}`);
}
const holdCounts = async () =>
  Object.fromEntries(
    (await q(owner.db, sql`select organization_id as org, count(*) filter (where status = 'proposed')::int as proposed from capacity_holds group by 1`)).map((r) => [r.org, r.proposed]),
  );

describe("jobs under the app role", () => {
  it("connects as careflow_app and lists organization ids only through the SECURITY DEFINER function", async () => {
    const [r] = await q(app.db, sql`select current_user as u, rolsuper, rolbypassrls from pg_roles where rolname = current_user`);
    expect(r).toEqual({ u: "careflow_app", rolsuper: false, rolbypassrls: false });
    expect((await listJobOrgIds(app.db)).sort()).toEqual([HARBOR.id, LAKESIDE.id].sort());
    // Without the function the app role sees no organizations at all.
    expect(await q(app.db, sql`select id from organizations`)).toEqual([]);
    const cols = await q(owner.db, sql`select pg_get_function_result('careflow_job_org_ids()'::regprocedure) as r`);
    expect(cols[0]!.r).toBe("SETOF uuid");
  });

  it("a job transaction sees only its own organization", async () => {
    const probe: Job = {
      name: "probe",
      schedule: "-",
      description: "test",
      run: async (db) => (await q(db, sql`select current_user as u, (select count(*)::int from organizations) as orgs, (select count(distinct organization_id)::int from inquiries) as inquiry_orgs, current_setting('app.current_org') as org`))[0],
    };
    const runs = await runJob(app.db, probe);
    expect(runs).toHaveLength(2);
    for (const r of runs) expect(r).toEqual({ orgId: r.orgId, ok: true, result: { u: "careflow_app", orgs: 1, inquiry_orgs: 1, org: r.orgId } });
  });

  it("expire-holds scoped with --org touches only that organization", async () => {
    await expireAllHolds();
    const auditsBefore = await q(owner.db, sql`select organization_id, count(*)::int n from audit_logs group by 1 order by 1`);
    const before = await holdCounts();
    expect(before[HARBOR.id]).toBeGreaterThan(0);
    expect(before[LAKESIDE.id]).toBe(1);

    const runs = await runJob(app.db, job("expire-holds"), { orgIds: [HARBOR.id], now: ANCHOR });
    expect(runs).toEqual([{ orgId: HARBOR.id, ok: true, result: { expired: before[HARBOR.id] } }]);
    expect(await holdCounts()).toEqual({ [HARBOR.id]: 0, [LAKESIDE.id]: 1 });

    const audits = await q(owner.db, sql`select organization_id, actor_id, request_id from audit_logs where action = 'hold.expire'`);
    expect(audits).toEqual([{ organization_id: HARBOR.id, actor_id: null, request_id: "job" }]);
    const auditsAfter = await q(owner.db, sql`select organization_id, count(*)::int n from audit_logs group by 1 order by 1`);
    expect(auditsAfter.find((a) => a.organization_id === LAKESIDE.id)).toEqual(auditsBefore.find((a) => a.organization_id === LAKESIDE.id));

    // Default: every organization, each in its own scope.
    const all = await runJob(app.db, job("expire-holds"), { now: ANCHOR });
    expect(all.find((r) => r.orgId === LAKESIDE.id)).toEqual({ orgId: LAKESIDE.id, ok: true, result: { expired: 1 } });
    expect(await holdCounts()).toEqual({ [HARBOR.id]: 0, [LAKESIDE.id]: 0 });
  });

  it("compute-daily-metrics writes rows for the scoped organization only", async () => {
    await owner.db.execute(sql`delete from daily_metrics`);
    const runs = await runJob(app.db, job("compute-daily-metrics"), { orgIds: [LAKESIDE.id], now: ANCHOR });
    expect(runs[0]!.ok).toBe(true);
    const rows = await q(owner.db, sql`select distinct organization_id from daily_metrics`);
    expect(rows).toEqual([{ organization_id: LAKESIDE.id }]);
  });

  it("every registered job runs for every organization without owner rights", async () => {
    for (const j of JOBS) {
      const runs = await runJob(app.db, j, { now: ANCHOR });
      expect({ job: j.name, failed: runs.filter((r) => !r.ok) }).toEqual({ job: j.name, failed: [] });
    }
  });

  it("rejects unknown organization ids before running anything", async () => {
    await expect(runJob(app.db, job("expire-holds"), { orgIds: ["00000000-0000-0000-0000-000000000000"] })).rejects.toThrow(/Unknown organization/);
    await expect(runJob(app.db, job("expire-holds"), { orgIds: ["not-a-uuid"] })).rejects.toThrow(/Unknown organization/);
  });
});
