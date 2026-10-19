import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getCenterCapacity, updateCenterCapacity, updateCenterPayers } from "../src/services/capacity";
import { evaluateMatchRequest } from "../src/services/matching";
import { approveMission, generateMissions, listMissions } from "../src/services/missions";
import { approveDraft, exportDraft, generateDraft, sendDraft, updateDraft } from "../src/services/drafts";
import { createExperiment, experimentResults, listExperiments, startExperiment } from "../src/services/experiments";
import { getDashboard } from "../src/services/metrics";
import { marketZctas, refreshMarket } from "../src/services/market";
import { centerId, payerId } from "../src/seed/fixtures";
import { ANCHOR, harbor, reseed, testDb } from "./helpers";

const { db, client } = testDb();
beforeAll(() => reseed(db));
afterAll(() => client.end());

const REQ = { serviceZip: "00106", payerId: payerId("meridian"), preferredModes: ["center" as const], preferredWindows: [1, 3, 4].map((d) => ({ dayOfWeek: d, startMinute: 840, endMinute: 1080 })), requestedDirectHoursPerWeek: 6 };
const byName = (r: Awaited<ReturnType<typeof evaluateMatchRequest>>, n: string) => r.matches.find((m) => m.centerName.startsWith(n))!;
const window90 = { from: new Date(ANCHOR.getTime() - 90 * 86_400_000), to: ANCHOR };

async function verifyWest(ctx = harbor("ops")) {
  const cap = await getCenterCapacity(db, ctx, centerId("west"));
  return updateCenterCapacity(db, ctx, centerId("west"), {
    version: cap.version,
    attestVerified: true,
    windows: cap.windows.map((w) => ({ role: w.role, dayOfWeek: w.dayOfWeek, startMinute: w.startMinute, endMinute: w.endMinute, weeklyAvailableHours: w.weeklyAvailableHours, serviceMode: w.serviceMode as "center" })),
    rules: cap.rules.map((r) => ({ payerId: r.payerId, requiredBcbaHoursPerDirectHour: r.requiredBcbaHoursPerDirectHour, minRbtCoverage: r.minRbtCoverage, maxNewStartsPerWeek: r.maxNewStartsPerWeek, isVerified: r.isVerified })),
  });
}

describe("acceptance demo chain", () => {
  it("seed produces exactly the three story missions and no demand-increasing ones", async () => {
    const ms = await listMissions(db, harbor());
    expect(ms.map((m) => `${m.ruleId}:${m.centerName}`).sort()).toEqual(["M1:North Center", "M3:North Center", "M4:South Center"]);
    expect(ms.some((m) => m.increasesDemand)).toBe(false);
  });

  it("Meridian is accepted by West but not North, and the matcher explains why", async () => {
    const r = await evaluateMatchRequest(db, harbor("intake"), REQ);
    expect(byName(r, "North").gates.find((g) => g.key === "payer")).toMatchObject({ status: "fail" });
    expect(byName(r, "West").gates.find((g) => g.key === "payer")).toMatchObject({ status: "pass" });
    expect(byName(r, "West").eligibility).toBe("verification_needed");
  });

  it("viewer cannot edit capacity or payers; intake cannot edit payers", async () => {
    await expect(verifyWest(harbor("viewer"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateCenterPayers(db, harbor("intake"), centerId("west"), { payers: [{ payerId: payerId("meridian"), status: "unknown" }] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("ops verifying West staff hours flips eligibility with a fresh evidence timestamp", async () => {
    const res = await verifyWest();
    expect(res.verifiedAt).toBe(ANCHOR.toISOString());
    const r = await evaluateMatchRequest(db, harbor("intake"), REQ);
    expect(byName(r, "West").eligibility).toBe("potential_fit");
    expect(byName(r, "West").capacityEvidenceAt).toBe(ANCHOR.toISOString());
    const d = await getDashboard(db, harbor(), window90);
    expect(d.siteMatrix.find((s) => s.centerName === "West Center")!.verifiedHours).toBe(45);
  });

  it("stale optimistic-lock versions are rejected", async () => {
    const cap = await getCenterCapacity(db, harbor("ops"), centerId("west"));
    await expect(updateCenterCapacity(db, harbor("ops"), centerId("west"), { version: cap.version - 1, windows: [], rules: [] })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("overlapping windows are rejected for reproducible capacity summation", async () => {
    const cap = await getCenterCapacity(db, harbor("ops"), centerId("west"));
    const w = { role: "RBT" as const, dayOfWeek: 1, serviceMode: "center" as const, weeklyAvailableHours: 2 };
    await expect(updateCenterCapacity(db, harbor("ops"), centerId("west"), { version: cap.version, rules: [], windows: [{ ...w, startMinute: 480, endMinute: 720 }, { ...w, startMinute: 600, endMinute: 900 }] })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("generating missions now adds West M2 from verified capacity, and never for North", async () => {
    const g = await generateMissions(db, harbor("growth"));
    expect(g.unchanged.length + g.refreshed.length).toBe(3);
    const ms = await listMissions(db, harbor());
    const m2 = ms.find((m) => m.ruleId === "M2")!;
    expect(m2.centerName).toBe("West Center");
    expect(m2.evidence.find((e) => e.metricKey === "verified_weekly_direct_hours_available")!.numerator).toBe(45);
    for (const m of ms.filter((x) => x.increasesDemand)) expect(m.centerName).toBe("West Center");
  });

  it("ops-gated missions require ops/admin approval; drafts only after approval", async () => {
    const m2 = (await listMissions(db, harbor())).find((m) => m.ruleId === "M2")!;
    await expect(generateDraft(db, harbor("growth"), { missionId: m2.id, kind: "partner_packet" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(approveMission(db, harbor("growth"), m2.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await approveMission(db, harbor("ops"), m2.id, "Ops confirmed availability");
  });

  it("AI-disabled drafting creates an accurate packet that cannot be sent; edits are re-validated", async () => {
    const m2 = (await listMissions(db, harbor())).find((m) => m.ruleId === "M2")!;
    const d = await generateDraft(db, harbor("growth"), { missionId: m2.id, kind: "partner_packet" });
    expect(d.generator).toBe("template");
    expect(d.bodyMd).toContain("Meridian Medicaid Plan (DEMO)");
    expect(d.bodyMd).not.toContain("Pinecrest");
    await expect(exportDraft(db, harbor("growth"), d.id, "md")).rejects.toMatchObject({ code: "CONFLICT" });
    const edited = await updateDraft(db, harbor("growth"), d.id, { bodyMd: `${d.bodyMd}\nWe also accept Pinecrest Health Network (DEMO) with no waitlist.`, revision: 1 });
    expect(edited.approvalStatus).toBe("needs_review");
    await expect(approveDraft(db, harbor("growth"), d.id)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const fixed = await updateDraft(db, harbor("growth"), d.id, { bodyMd: d.bodyMd, revision: 2 });
    expect(fixed.approvalStatus).toBe("draft");
    const approved = await approveDraft(db, harbor("growth"), d.id);
    expect(approved.approvalStatus).toBe("approved");
    await expect(sendDraft(db, harbor("admin"), d.id)).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
    expect((await exportDraft(db, harbor("growth"), d.id, "html")).content).toContain("<h1>");
  });

  it("connects a partner-randomized experiment with persisted HMAC assignments", async () => {
    const m2 = (await listMissions(db, harbor())).find((m) => m.ruleId === "M2")!;
    const e = await createExperiment(db, harbor("growth"), {
      centerId: centerId("west"), missionId: m2.id, name: "West packet test", hypothesis: "A factual packet increases verified starts.", primaryMetric: "care_starts",
      designType: "randomized", assignmentUnit: "partner", variants: [{ key: "control", description: "Current", allocationPct: 50 }, { key: "treatment", description: "Packet", allocationPct: 50 }],
    });
    // not randomized until assignments are persisted
    expect((await experimentResults(db, harbor(), e.id)).randomized).toBe(false);
    await startExperiment(db, harbor("growth"), e.id);
    const r = await experimentResults(db, harbor(), e.id);
    expect(r.randomized).toBe(true);
    expect(r.analysis.verdict).toBe("insufficient_evidence");
    expect((await listMissions(db, harbor())).find((m) => m.id === m2.id)!.status).toBe("in_progress");
  });

  it("seeded observational experiment is descriptive only and labelled simulated", async () => {
    const obs = (await listExperiments(db, harbor())).find((x) => x.designType === "observational")!;
    const r = await experimentResults(db, harbor(), obs.id);
    expect(r.randomized).toBe(false);
    expect(["descriptive_only", "insufficient_evidence"]).toContain(r.analysis.verdict);
    expect(r.analysis.difference?.interval ?? null).toBeNull();
    expect(r.simulated).toBe(true);
  });
});

describe("metrics consistency", () => {
  it("filtering by site splits numerators and denominators consistently", async () => {
    const all = await getDashboard(db, harbor(), window90);
    const per = await Promise.all(["north", "west", "south"].map((k) => getDashboard(db, harbor(), { ...window90, centerId: centerId(k) })));
    const sum = (f: (d: typeof all) => number) => per.reduce((s, d) => s + f(d), 0);
    expect(sum((d) => d.kpis.inquiries_created.value)).toBeLessThanOrEqual(all.kpis.inquiries_created.value);
    expect(sum((d) => d.kpis.cohort_start_rate.denominator)).toBeLessThanOrEqual(all.kpis.cohort_start_rate.denominator);
    expect(sum((d) => d.kpis.care_starts.value)).toBe(all.kpis.care_starts.value);
    const src = await getDashboard(db, harbor(), { ...window90, source: "phone" });
    expect(src.kpis.inquiries_created.value).toBeLessThan(all.kpis.inquiries_created.value);
    expect(src.kpis.cohort_start_rate.denominator).toBe(src.kpis.inquiries_created.value);
  });

  it("analytics responses contain aggregates only (no aliases)", async () => {
    const json = JSON.stringify(await getDashboard(db, harbor(), window90));
    expect(json).not.toMatch(/Demo Family/);
  });
});

describe("public data resilience", () => {
  it("missing ACS key records a skipped run and the demo map still works", async () => {
    const r = await refreshMarket(db, harbor(), { env: {} });
    expect(r.results.find((x) => x.sourceKey === "census_acs_2024_b01001")!.status).toBe("skipped");
    expect((await marketZctas(db, harbor())).zctas.length).toBe(12);
  });

  it("network failure records a failed snapshot without touching seeded data", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const r = await refreshMarket(db, harbor(), { env: { CENSUS_API_KEY: "test", ACS_ZCTAS: "92618" }, fetchImpl });
    expect(r.results.find((x) => x.sourceKey === "census_acs_2024_b01001")).toMatchObject({ status: "failed" });
    const m = await marketZctas(db, harbor());
    expect(m.zctas.filter((z) => z.demoFixture)).toHaveLength(12);
    expect(m.zctas.find((z) => z.zcta5 === "00108")!.opportunity.ranked).toBe(false);
  });

  it("only admins may refresh", async () => {
    await expect(refreshMarket(db, harbor("growth"), { env: {} })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
