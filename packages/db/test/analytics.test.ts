import { EQUITY_STEPS } from "@careflow/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { organizations } from "../src/schema";
import { HARBOR, centerId } from "../src/seed/fixtures";
import { equityAudit } from "../src/services/equity";
import { createExperiment, experimentResults, listExperiments, startExperiment } from "../src/services/experiments";
import { harbor, lakeside, reseed, testDb } from "./helpers";

const { db, client } = testDb();
beforeAll(() => reseed(db));
afterAll(() => client.end());

describe("equity audit (aggregate-only, suppressed)", () => {
  it("reports per-payer-group access rates for the seed cohort with the notice", async () => {
    const r = await equityAudit(db, harbor());
    expect(r.notice).toMatch(/Equity audit only — never used for scoring, ranking, matching or exclusion/);
    expect(r.minCellSize).toBe(5);
    expect(r.window.days).toBe(90);
    expect(r.groups.map((g) => g.key).sort()).toEqual(["commercial", "medicaid_managed_care", "not_recorded"]);
    expect(r.overall.inquiries).toBe(150);
    expect(r.groups.reduce((s, g) => s + (g.inquiries ?? 0), 0)).toBe(150);
    expect(r.overall.steps.care_started).toMatchObject({ numerator: 30, denominator: 150, suppressed: null });
    expect(r.overall.steps.assessment_scheduled).toMatchObject({ numerator: 48, denominator: 150 });
    const comm = r.groups.find((g) => g.key === "commercial")!;
    expect(comm.steps.care_started).toMatchObject({ numerator: 17, denominator: 99 });
    expect(comm.steps.care_started.differenceVsOverall).toBeCloseTo(17 / 99 - 30 / 150, 12);
  });

  it("applies primary and complementary suppression on the seed", async () => {
    const r = await equityAudit(db, harbor());
    // only 3 proposed holds in the seed → the overall match-proposed cell is below k
    expect(r.overall.steps.match_proposed.suppressed).toBe("primary");
    expect(r.groups.find((g) => g.key === "commercial")!.steps.match_proposed.suppressed).toBe("primary");
    // a single primary-suppressed SLA cell forces a complementary one
    const sla = r.groups.map((g) => g.steps.contact_within_sla.suppressed);
    expect(sla.filter(Boolean).length).toBe(2);
    expect(sla).toContain("complementary");
    expect(r.suppressedCells).toBeGreaterThanOrEqual(4);
    for (const { key } of EQUITY_STEPS) {
      const hidden = r.groups.filter((g) => g.steps[key].suppressed).length;
      if (!r.overall.steps[key].suppressed) expect(hidden === 0 || hidden >= 2).toBe(true);
    }
  });

  it("returns counts only — no inquiry identifiers or aliases", async () => {
    const json = JSON.stringify(await equityAudit(db, harbor()));
    expect(json).not.toMatch(/inquiryId|contactAlias|serviceZip/);
    expect(json).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it("uses the tenant minCellSize policy", async () => {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, HARBOR.id));
    await db.update(organizations).set({ settings: { ...(org!.settings as object), minCellSize: 25 } }).where(eq(organizations.id, HARBOR.id));
    try {
      const r = await equityAudit(db, harbor());
      expect(r.minCellSize).toBe(25);
      const notRecorded = r.groups.find((g) => g.key === "not_recorded")!; // 18 inquiries < 25
      expect(notRecorded.inquiries).toBeNull();
      expect(r.groups.filter((g) => g.inquiriesSuppressed).length).toBe(2);
      expect(r.overall.inquiries).toBe(150);
    } finally {
      await db.update(organizations).set({ settings: org!.settings }).where(eq(organizations.id, HARBOR.id));
    }
  });

  it("filters by site and validates input", async () => {
    const north = await equityAudit(db, harbor(), { centerId: centerId("north"), days: 60 });
    expect(north.centerName).toBe("North Center");
    expect(north.overall.inquiries ?? 0).toBeLessThan(150);
    await expect(equityAudit(db, harbor(), { centerId: "00000000-0000-4000-8000-000000000999" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(equityAudit(db, harbor(), { days: 3 })).rejects.toThrow();
  });

  it("is tenant-scoped", async () => {
    const r = await equityAudit(db, lakeside());
    expect(r.overall.inquiries).toBe(5);
    await expect(equityAudit(db, lakeside(), { centerId: centerId("north") })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("RBAC: admin, growth and ops only", async () => {
    for (const role of ["admin", "growth", "ops"] as const) await expect(equityAudit(db, harbor(role))).resolves.toBeTruthy();
    for (const role of ["intake", "viewer"] as const) await expect(equityAudit(db, harbor(role))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("cluster-aware experiment results", () => {
  it("seeded partner-randomized experiment reports clusters per arm and stays insufficient", async () => {
    const rnd = (await listExperiments(db, harbor())).find((x) => x.designType === "randomized")!;
    const r = await experimentResults(db, harbor(), rnd.id);
    expect(r.randomized).toBe(true);
    expect(r.analysis.intervalMethod).toBe("cluster_robust");
    expect(r.analysis.minClustersPerArm).toBe(10);
    expect(r.analysis.arms.reduce((s, a) => s + a.units, 0)).toBe(rnd.assignmentCount);
    for (const a of r.analysis.arms) {
      expect(a.clustersWithData).not.toBeNull();
      expect(a.clustersWithData!).toBeLessThanOrEqual(a.units);
    }
    expect(r.analysis.verdict).toBe("insufficient_evidence");
    expect(r.analysis.difference?.interval ?? null).toBeNull();
    expect(r.analysis.caveats.join(" ")).toMatch(/partners with data/);
  });

  it("site-week randomized experiments are analysed by assigned week, not before/after", async () => {
    const e = await createExperiment(db, harbor("growth"), {
      centerId: centerId("south"), name: "South scheduling-hours notice", hypothesis: "Posting verified intake hours weekly increases starts.", primaryMetric: "care_starts",
      designType: "randomized", assignmentUnit: "site_week", plannedDurationDays: 56,
      variants: [{ key: "control", description: "Current", allocationPct: 50 }, { key: "notice", description: "Hours notice", allocationPct: 50 }],
    });
    await startExperiment(db, harbor("growth"), e.id);
    const r = await experimentResults(db, harbor(), e.id);
    expect(r.randomized).toBe(true);
    expect(r.comparison).toMatch(/site-week/);
    expect(r.analysis.arms.map((a) => a.key)).toEqual(["control", "notice"]);
    expect(r.analysis.arms.reduce((s, a) => s + a.units, 0)).toBe(8);
    expect(r.analysis.intervalMethod).toBe("cluster_robust");
    expect(r.analysis.verdict).toBe("insufficient_evidence");
  });

  it("non-randomized experiments keep the individual-level method", async () => {
    const obs = (await listExperiments(db, harbor())).find((x) => x.designType === "observational")!;
    const r = await experimentResults(db, harbor(), obs.id);
    expect(r.analysis.intervalMethod).toBe("wilson_newcombe");
    expect(r.analysis.arms.every((a) => a.clustersWithData === null)).toBe(true);
  });
});
