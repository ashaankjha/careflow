import { describe, expect, it } from "vitest";
import { generateMissionProposals, reportingWeek, type CenterSignals, type OrgSignals } from "../src/missions";
import { DEFAULT_POLICY } from "../src/policy";
import { createRng } from "../src/stats";
import { NOW } from "./fixtures";

const base = (over: Partial<CenterSignals> = {}): CenterSignals => ({
  centerId: "c-1",
  centerName: "Site",
  windowDays: 30,
  recentInquiries: 20,
  peerMedianInquiries: 20,
  verifiedHoursAvailable: 10,
  pendingHours: 0,
  matchEvaluated: 20,
  matchNotFeasible: 2,
  slaEligible: 20,
  slaMissed: 2,
  benefitsPending: 3,
  benefitsStalled: 0,
  benefitsStallThresholdDays: 10,
  stageConversion: [],
  publicProfileStatus: "current",
  partnerAttributedStarts: 3,
  ...over,
});
const org: OrgSignals = { partnerStarts: [], totalPartnerAttributedStarts: 0 };
const run = (cs: CenterSignals[], o = org) => generateMissionProposals(cs, o, DEFAULT_POLICY, NOW);

describe("mission rules", () => {
  it("M1 fires for high demand with low verified capacity and holds demand", () => {
    const m = run([base({ verifiedHoursAvailable: 2, matchNotFeasible: 15 })]);
    const m1 = m.find((x) => x.ruleId === "M1")!;
    expect(m1.increasesDemand).toBe(false);
    expect(m1.proposedAction).toMatch(/ON HOLD/);
    expect(m1.evidence.find((e) => e.metricKey === "match_not_feasible_share")).toMatchObject({ numerator: 15, denominator: 20 });
  });

  it("M2 fires for verified unused capacity with below-peer inquiry flow", () => {
    const m = run([base({ verifiedHoursAvailable: 40, recentInquiries: 8, peerMedianInquiries: 20 })]);
    const m2 = m.find((x) => x.ruleId === "M2")!;
    expect(m2.requiresOpsReview).toBe(true);
    expect(m2.experiment.designType).toBe("randomized");
    expect(m2.experiment.assignmentUnit).toBe("partner");
  });

  it("M3, M4, M7 fire on their evidence", () => {
    expect(run([base({ slaMissed: 9 })]).some((x) => x.ruleId === "M3")).toBe(true);
    expect(run([base({ benefitsStalled: 6, benefitsPending: 9 })]).some((x) => x.ruleId === "M4")).toBe(true);
    expect(run([base({ verifiedHoursAvailable: 40, publicProfileStatus: "missing" })]).some((x) => x.ruleId === "M7")).toBe(true);
  });

  it("M5 requires sufficient N and a material drop versus baseline", () => {
    const conv = { stage: "qualified", recentEntered: 20, recentAdvanced: 8, baselineEntered: 20, baselineAdvanced: 16 };
    expect(run([base({ stageConversion: [conv] })]).some((x) => x.ruleId === "M5")).toBe(true);
    expect(run([base({ stageConversion: [{ ...conv, recentEntered: 5, recentAdvanced: 1 }] })]).some((x) => x.ruleId === "M5")).toBe(false);
  });

  it("M6 fires on referral concentration for a site with verified capacity", () => {
    const o = { partnerStarts: [{ partnerId: "p1", partnerName: "Big Partner", starts: 8 }, { partnerId: "p2", partnerName: "Small", starts: 2 }], totalPartnerAttributedStarts: 10 };
    const m = run([base({ verifiedHoursAvailable: 40, partnerAttributedStarts: 0 })], o);
    expect(m.find((x) => x.ruleId === "M6")?.evidence[0]).toMatchObject({ numerator: 8, denominator: 10 });
  });

  it("never advocates more demand for a center with exhausted or unverified capacity (property test)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 500; i++) {
      const vh = rng.chance(0.2) ? null : rng.int(0, 60);
      const c = base({
        verifiedHoursAvailable: vh,
        recentInquiries: rng.int(0, 40),
        peerMedianInquiries: rng.int(0, 40),
        matchEvaluated: 20,
        matchNotFeasible: rng.int(0, 20),
        publicProfileStatus: rng.pick(["current", "outdated", "missing"] as const),
        partnerAttributedStarts: rng.int(0, 3),
      });
      const o = { partnerStarts: [{ partnerId: "p", partnerName: "P", starts: 9 }], totalPartnerAttributedStarts: 10 };
      for (const m of run([c], o)) {
        if (m.increasesDemand) {
          expect(vh).not.toBeNull();
          expect(vh!).toBeGreaterThanOrEqual(DEFAULT_POLICY.missions.m2MinVerifiedHours);
        }
      }
    }
  });

  it("dedupes by (center, rule, reporting week) and orders by priority", () => {
    const m = run([base({ verifiedHoursAvailable: 2, matchNotFeasible: 15, slaMissed: 9 })]);
    expect(new Set(m.map((x) => x.dedupeKey)).size).toBe(m.length);
    expect(m[0]!.dedupeKey).toContain(reportingWeek(NOW));
    for (let i = 1; i < m.length; i++) expect(m[i - 1]!.priorityScore).toBeGreaterThanOrEqual(m[i]!.priorityScore);
    for (const x of m) expect(x.confidenceScore).toBeLessThanOrEqual(0.9);
  });
});
