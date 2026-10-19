import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getCenterCapacity, updateCenterCapacity } from "../src/services/capacity";
import { getInquiryDetail, transitionInquiry } from "../src/services/inquiries";
import { approveMission, getMission, listMissions } from "../src/services/missions";
import { getDashboard } from "../src/services/metrics";
import { experimentResults, listExperiments } from "../src/services/experiments";
import { getDraft } from "../src/services/drafts";
import { persistInquiryMatches } from "../src/services/matching";
import { centerId, HARBOR, LAKESIDE, seedUuid } from "../src/index";
import { ANCHOR, harbor, lakeside, pgError, reseed, testDb } from "./helpers";

const { db, client } = testDb();
beforeAll(() => reseed(db));
afterAll(() => client.end());

const harborInquiry = seedUuid("inquiry:harbor:north:0");

describe("cross-tenant isolation (guessing UUIDs)", () => {
  it("organization B cannot read or change organization A inquiries", async () => {
    await expect(getInquiryDetail(db, lakeside(), harborInquiry)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(transitionInquiry(db, lakeside(), harborInquiry, { toStage: "withdrawn", reason: "x", eventIdempotencyKey: "xtenant-1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(persistInquiryMatches(db, lakeside(), harborInquiry)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("organization B cannot read or change organization A centers, missions, experiments or drafts", async () => {
    await expect(getCenterCapacity(db, lakeside(), centerId("west"))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateCenterCapacity(db, lakeside(), centerId("west"), { version: 1, windows: [], rules: [] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const m = (await listMissions(db, harbor()))[0]!;
    await expect(getMission(db, lakeside(), m.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(approveMission(db, lakeside(), m.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const e = (await listExperiments(db, harbor()))[0]!;
    await expect(experimentResults(db, lakeside(), e.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getDraft(db, lakeside(), seedUuid("nonexistent"))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("metrics and lists never leak across tenants", async () => {
    const d = await getDashboard(db, lakeside(), { from: new Date(ANCHOR.getTime() - 90 * 86_400_000), to: ANCHOR });
    expect(d.kpis.inquiries_created.value).toBe(5);
    expect(d.siteMatrix.map((s) => s.centerName)).toEqual(["Lakeside Main Clinic (DEMO)"]);
    expect((await listMissions(db, lakeside())).every((m) => m.organizationId === LAKESIDE.id)).toBe(true);
    expect(await listExperiments(db, lakeside())).toEqual([]);
  });

  it("composite foreign keys prevent cross-tenant row combinations", async () => {
    expect(await pgError(db.execute(sql`insert into center_payers (organization_id, center_id, payer_id, status) values (${LAKESIDE.id}, ${centerId("west")}, ${seedUuid("payer:lakeside:prairie")}, 'unknown')`))).toMatch(/foreign key/);
  });

  it("Postgres RLS policies restrict a non-owner role to the current tenant", async () => {
    await db.execute(sql.raw(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'careflow_rls_probe') then create role careflow_rls_probe nologin; end if; end $$`));
    await db.execute(sql.raw(`grant select on inquiries to careflow_rls_probe`));
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`set local role careflow_rls_probe`));
      await tx.execute(sql`select set_config('app.current_org', ${LAKESIDE.id}, true)`);
      const r = (await tx.execute(sql`select distinct organization_id from inquiries`)) as unknown as { organization_id: string }[];
      await tx.execute(sql`select set_config('app.current_org', '', true)`);
      const none = (await tx.execute(sql`select count(*)::int n from inquiries`)) as unknown as { n: number }[];
      return { orgs: r.map((x) => x.organization_id), unscoped: none[0]!.n };
    });
    expect(rows.orgs).toEqual([LAKESIDE.id]);
    expect(rows.unscoped).toBe(0);
    expect(rows.orgs).not.toContain(HARBOR.id);
  });
});

describe("audit trail", () => {
  it("audit records cannot be rewritten", async () => {
    expect(await pgError(db.execute(sql`update audit_logs set action = 'tampered' where organization_id = ${HARBOR.id}`))).toMatch(/IMMUTABLE_RECORD/);
  });
  it("reads of inquiry details are audited without sensitive values", async () => {
    await getInquiryDetail(db, harbor("growth"), harborInquiry);
    const r = (await db.execute(sql`select action, details from audit_logs where entity_id = ${harborInquiry} order by event_time desc limit 1`)) as unknown as { action: string; details: unknown }[];
    expect(r[0]!.action).toBe("inquiry.read");
    expect(JSON.stringify(r[0]!.details)).not.toMatch(/Demo Family/);
  });
});
