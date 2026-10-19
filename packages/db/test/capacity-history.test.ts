import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getCenterCapacity, listCapacityVersions, loadCapacityTimeline, updateCenterCapacity } from "../src/services/capacity";
import { createInquiry } from "../src/services/inquiries";
import { evaluateMatchRequest } from "../src/services/matching";
import { capacityFit, getDashboard } from "../src/services/metrics";
import { generateMissions, listMissions } from "../src/services/missions";
import { HARBOR, LAKESIDE, centerId, payerId } from "../src/seed/fixtures";
import { ANCHOR, harbor, lakeside, pgError, reseed, testDb } from "./helpers";

const { db, client } = testDb();
beforeAll(() => reseed(db));
afterAll(() => client.end());

const HOUR = 3_600_000;
const window90 = { from: new Date(ANCHOR.getTime() - 90 * 86_400_000), to: ANCHOR };
const WEST = centerId("west");
const meridian = (key: string, now: Date) =>
  createInquiry(db, { ...harbor("intake"), now }, {
    contactAlias: `Demo Family ${key}`,
    serviceZip: "00106",
    payerId: payerId("meridian"),
    preferredModes: ["center"],
    preferredWindows: [1, 3, 4].map((d) => ({ dayOfWeek: d, startMinute: 840, endMinute: 1080 })),
    requestedDirectHoursPerWeek: 6,
    sourceChannel: "phone",
    idempotencyKey: `history-${key}`,
    syntheticAcknowledged: true,
  });

async function verifyWest() {
  const ctx = harbor("ops");
  const cap = await getCenterCapacity(db, ctx, WEST);
  return updateCenterCapacity(db, ctx, WEST, {
    version: cap.version,
    attestVerified: true,
    windows: cap.windows.map((w) => ({ role: w.role, dayOfWeek: w.dayOfWeek, startMinute: w.startMinute, endMinute: w.endMinute, weeklyAvailableHours: w.weeklyAvailableHours, serviceMode: w.serviceMode as "center" })),
    rules: cap.rules.map((r) => ({ payerId: r.payerId, requiredBcbaHoursPerDirectHour: r.requiredBcbaHoursPerDirectHour, minRbtCoverage: r.minRbtCoverage, maxNewStartsPerWeek: r.maxNewStartsPerWeek, isVerified: r.isVerified })),
  });
}

describe("seeded capacity history", () => {
  it("every center has a version in force at every seeded inquiry's creation time, with one open version", async () => {
    for (const ctx of [harbor(), lakeside()]) {
      const timeline = await loadCapacityTimeline(db, ctx);
      const created = (await db.execute(sql`select created_at from inquiries where organization_id = ${ctx.orgId}`)) as unknown as { created_at: Date }[];
      expect(created.length).toBeGreaterThan(0);
      for (const r of created) expect(timeline.covered(new Date(r.created_at))).toBe(true);
    }
    const open = (await db.execute(
      sql`select center_id, count(*)::int n from capacity_versions where organization_id in (${HARBOR.id}, ${LAKESIDE.id}) and valid_to is null group by center_id`,
    )) as unknown as { n: number }[];
    expect(open).toHaveLength(4);
    expect(open.every((o) => o.n === 1)).toBe(true);
  });

  it("the open version matches the live capacity sheet and the center's capacity_version", async () => {
    const cap = await getCenterCapacity(db, harbor(), WEST);
    const [latest] = await listCapacityVersions(db, harbor(), WEST, 1);
    expect(latest!.version).toBe(cap.version);
    expect(latest!.validTo).toBeNull();
    const rows = (await db.execute(
      sql`select role, day_of_week, start_minute, weekly_available_hours, verified_at from staff_capacity_window_versions where capacity_version_id = ${latest!.id}`,
    )) as unknown as { role: string; day_of_week: number; start_minute: number; weekly_available_hours: number; verified_at: Date | null }[];
    const key = (x: unknown[]) => x.slice(0, 3).join(":");
    const sorted = (xs: unknown[][]) => xs.sort((a, b) => key(a).localeCompare(key(b)));
    expect(sorted(rows.map((r) => [r.role, r.day_of_week, r.start_minute, r.weekly_available_hours, r.verified_at ? new Date(r.verified_at).toISOString() : null]))).toEqual(
      sorted(cap.windows.map((w) => [w.role, w.dayOfWeek, w.startMinute, w.weeklyAvailableHours, w.verifiedAt?.toISOString() ?? null])),
    );
  });
});

describe("as-of capacity fit", () => {
  it("a capacity edit does not rewrite past cohorts' fit, but applies to inquiries after it", async () => {
    const before = await meridian("before-edit", new Date(ANCHOR.getTime() - HOUR));
    const dashBefore = await getDashboard(db, harbor(), window90);

    await verifyWest(); // at ANCHOR: West Meridian request flips to potential_fit for live matching
    const live = await evaluateMatchRequest(db, harbor("intake"), {
      serviceZip: "00106",
      payerId: payerId("meridian"),
      preferredModes: ["center"],
      preferredWindows: [1, 3, 4].map((d) => ({ dayOfWeek: d, startMinute: 840, endMinute: 1080 })),
      requestedDirectHoursPerWeek: 6,
    });
    expect(live.matches.find((m) => m.centerId === WEST)!.eligibility).toBe("potential_fit");

    const dashAfter = await getDashboard(db, harbor(), window90);
    expect(dashAfter.kpis.capacity_fit_rate).toEqual(dashBefore.kpis.capacity_fit_rate);
    expect(dashAfter.kpis.capacity_fit_rate.asOf).toBe("inquiry_created_at");
    expect(dashAfter.kpis.capacity_fit_rate.withoutCapacityVersion).toBe(0);

    const after = await meridian("after-edit", new Date(ANCHOR.getTime() + HOUR));
    const later = { ...harbor(), now: new Date(ANCHOR.getTime() + 2 * HOUR) };
    const fit = await capacityFit(db, later, { from: new Date(ANCHOR.getTime() - 2 * HOUR), to: new Date(ANCHOR.getTime() + 2 * HOUR) });
    // identical requests: only the one created after ops verified West is a potential fit
    expect(fit.denominator).toBe(2);
    expect(fit.numerator).toBe(1);
    expect(before.inquiry.id).not.toBe(after.inquiry.id);
  });

  it("the edit closed the previous version and opened a new one at the save time", async () => {
    const versions = await listCapacityVersions(db, harbor(), WEST);
    expect(versions[0]).toMatchObject({ validTo: null, attested: true });
    expect(versions[0]!.validFrom.getTime()).toBe(ANCHOR.getTime());
    expect(versions[1]!.validTo!.getTime()).toBe(ANCHOR.getTime());
  });

  it("the acceptance chain is unchanged: West M2 appears only from current verified capacity", async () => {
    await generateMissions(db, harbor("growth"));
    const ms = await listMissions(db, harbor());
    expect(ms.filter((m) => m.ruleId === "M1").map((m) => m.centerName)).toEqual(["North Center"]);
    expect(ms.find((m) => m.ruleId === "M2")!.centerName).toBe("West Center");
  });
});

describe("history integrity", () => {
  it("window versions are immutable and headers can only be closed once", async () => {
    expect(await pgError(db.execute(sql`update staff_capacity_window_versions set weekly_available_hours = 99 where organization_id = ${HARBOR.id}`))).toMatch(/IMMUTABLE_RECORD/);
    expect(await pgError(db.execute(sql`delete from staff_capacity_window_versions where organization_id = ${HARBOR.id}`))).toMatch(/IMMUTABLE_RECORD/);
    expect(await pgError(db.execute(sql`update capacity_versions set valid_from = valid_from - interval '1 day' where organization_id = ${HARBOR.id}`))).toMatch(/IMMUTABLE_RECORD/);
    expect(await pgError(db.execute(sql`update capacity_versions set valid_to = null where organization_id = ${HARBOR.id} and valid_to is not null`))).toMatch(/IMMUTABLE_RECORD/);
  });

  it("forced RLS restricts a non-owner role to the current tenant's history", async () => {
    await db.execute(sql.raw(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'careflow_rls_probe') then create role careflow_rls_probe nologin; end if; end $$`));
    await db.execute(sql.raw(`grant select on capacity_versions, staff_capacity_window_versions to careflow_rls_probe`));
    const res = await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`set local role careflow_rls_probe`));
      await tx.execute(sql`select set_config('app.current_org', ${LAKESIDE.id}, true)`);
      const orgs = (await tx.execute(sql`select distinct organization_id from staff_capacity_window_versions`)) as unknown as { organization_id: string }[];
      await tx.execute(sql`select set_config('app.current_org', '', true)`);
      const none = (await tx.execute(sql`select count(*)::int n from capacity_versions`)) as unknown as { n: number }[];
      return { orgs: orgs.map((o) => o.organization_id), unscoped: none[0]!.n };
    });
    expect(res.orgs).toEqual([LAKESIDE.id]);
    expect(res.unscoped).toBe(0);
    const forced = (await db.execute(
      sql`select relname, relforcerowsecurity from pg_class where relname in ('capacity_versions', 'staff_capacity_window_versions')`,
    )) as unknown as { relforcerowsecurity: boolean }[];
    expect(forced.every((r) => r.relforcerowsecurity)).toBe(true);
  });

  it("a center's version history is tenant-scoped", async () => {
    await expect(listCapacityVersions(db, lakeside(), WEST)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
