import { describe, expect, it } from "vitest";
import { evaluateCenter, evaluateMatch, verifiedDirectHoursAvailable } from "../src/matching";
import { DEFAULT_POLICY } from "../src/policy";
import { center, ctx, daysAgo, NOW, PAYER_B, REQUEST } from "./fixtures";

const gate = (m: ReturnType<typeof evaluateCenter>, key: string) => m.gates.find((g) => g.key === key)!;

describe("hard gates", () => {
  it("verified payer mismatch excludes the center as a verified match", () => {
    const c = center("c-1", { payers: [{ payerId: PAYER_B, status: "not_accepted", lastVerifiedAt: daysAgo(5) }] });
    const m = evaluateCenter(REQUEST, c, ctx());
    expect(gate(m, "payer").status).toBe("fail");
    expect(m.eligibility).toBe("not_feasible");
    expect(m.score).toBeNull();
  });

  it("unknown payer leads to verification_needed — not a denial and not a match", () => {
    const c = center("c-1", { payers: [{ payerId: PAYER_B, status: "unknown", lastVerifiedAt: null }] });
    const m = evaluateCenter(REQUEST, c, ctx());
    expect(gate(m, "payer").status).toBe("verification_needed");
    expect(m.eligibility).toBe("verification_needed");
  });

  it("stale payer verification is not treated as verified", () => {
    const c = center("c-1", { payers: [{ payerId: PAYER_B, status: "verified_accepted", lastVerifiedAt: daysAgo(400) }] });
    expect(gate(evaluateCenter(REQUEST, c, ctx()), "payer").status).toBe("verification_needed");
  });

  it("missing payer keeps the family in play with a follow-up action", () => {
    const r = evaluateMatch({ ...REQUEST, payerId: null }, [center("c-1")], ctx());
    expect(r.status).toBe("verification_needed");
    expect(r.requiredStaffActions.join(" ")).toMatch(/Record payer information/);
  });

  it("unknown coordinates or ZCTA yield verification_needed, never a fabricated distance", () => {
    const m = evaluateCenter(REQUEST, center("c-1"), ctx({ zcta: null }));
    expect(gate(m, "geography").status).toBe("verification_needed");
    expect(m.distanceMiles).toBeNull();
  });

  it("out-of-radius fails geography with the distance", () => {
    const m = evaluateCenter(REQUEST, center("c-1", { latitude: 33.5 }), ctx());
    expect(gate(m, "geography").status).toBe("fail");
    expect(gate(m, "geography").reason).toMatch(/exceeds/);
  });

  it("no candidate with unknown or unverified supervision rules is labelled a potential fit", () => {
    for (const rules of [[], [{ payerId: null, requiredBcbaHoursPerDirectHour: 0.1, maxNewStartsPerWeek: 4, isVerified: false }], [{ payerId: null, requiredBcbaHoursPerDirectHour: null, maxNewStartsPerWeek: 4, isVerified: true }]]) {
      const m = evaluateCenter(REQUEST, center("c-1", { rules }), ctx());
      expect(m.eligibility).not.toBe("potential_fit");
      expect(gate(m, "bcba_supervision").status).toBe("verification_needed");
    }
  });

  it("unverified staff hours never count as verified capacity", () => {
    const c = center("c-1");
    c.windows = c.windows.map((w) => (w.role === "RBT" ? { ...w, verifiedAt: null } : w));
    const m = evaluateCenter(REQUEST, c, ctx());
    expect(gate(m, "rbt_schedule").status).toBe("verification_needed");
    expect(m.capacity.verifiedRbtOverlapHours).toBe(0);
  });
});

describe("capacity changes feasibility predictably", () => {
  it("raising RBT hours flips not_feasible → potential_fit", () => {
    const low = center("c-1");
    low.windows = low.windows.map((w) => (w.role === "RBT" ? { ...w, weeklyAvailableHours: 1 } : w));
    expect(evaluateCenter(REQUEST, low, ctx()).eligibility).toBe("not_feasible");
    const high = center("c-1");
    expect(evaluateCenter(REQUEST, high, ctx()).eligibility).toBe("potential_fit");
    // overlap: 4h of a 5h window × 5h × 3 days = 12h
    expect(evaluateCenter(REQUEST, high, ctx()).capacity.verifiedRbtOverlapHours).toBe(12);
  });

  it("insufficient BCBA supervision fails with the computed requirement", () => {
    const c = center("c-1");
    c.windows = c.windows.map((w) => (w.role === "BCBA" ? { ...w, weeklyAvailableHours: 0.2 } : w));
    const m = evaluateCenter(REQUEST, c, ctx());
    expect(gate(m, "bcba_supervision").status).toBe("fail");
    expect(m.capacity.bcbaRequiredHours).toBeCloseTo(0.6);
  });

  it("holds and weekly new-start limits are enforced", () => {
    const held = evaluateCenter(REQUEST, center("c-1", { holds: [{ directWeeklyHours: 20, bcbaWeeklyHours: 1 }] }), ctx());
    expect(gate(held, "rbt_schedule").status).toBe("fail");
    const limited = evaluateCenter(REQUEST, center("c-1", { startsLast7Days: 4 }), ctx());
    expect(gate(limited, "new_start_limit").status).toBe("fail");
  });

  it("capacity evidence timestamp reflects verification time", () => {
    const m = evaluateCenter(REQUEST, center("c-1"), ctx());
    expect(m.capacityEvidenceAt).toBe(daysAgo(3).toISOString());
  });

  it("verified direct hours KPI subtracts holds and respects BCBA cap", () => {
    const c = center("c-1", { holds: [{ directWeeklyHours: 5, bcbaWeeklyHours: 0.5 }] });
    expect(verifiedDirectHoursAvailable(c, { now: NOW, policy: DEFAULT_POLICY }).hours).toBe(20);
    c.windows = c.windows.map((w) => (w.role === "BCBA" ? { ...w, weeklyAvailableHours: 1 } : w));
    expect(verifiedDirectHoursAvailable(c, { now: NOW, policy: DEFAULT_POLICY }).hours).toBe(5);
  });
});

describe("ranking", () => {
  it("scores 0..100 with a normalized breakdown and ranks deterministically", () => {
    const r = evaluateMatch(REQUEST, [center("c-2"), center("c-1")], ctx());
    expect(r.status).toBe("potential_fit");
    for (const m of r.matches) {
      expect(m.score).toBeGreaterThanOrEqual(0);
      expect(m.score).toBeLessThanOrEqual(100);
      for (const v of Object.values(m.scoreComponents!)) expect(v).toBeGreaterThanOrEqual(0);
    }
    // identical centers tie → fairness-preserving tie-break by center id
    expect(r.matches.map((m) => m.centerId)).toEqual(["c-1", "c-2"]);
    expect(evaluateMatch(REQUEST, [center("c-1"), center("c-2")], ctx())).toEqual(r);
  });

  it("returns no_feasible_match with an alternate-path action", () => {
    const r = evaluateMatch({ ...REQUEST, preferredModes: ["home"] }, [center("c-1")], ctx());
    expect(r.status).toBe("no_feasible_match");
    expect(r.requiredStaffActions.join(" ")).toMatch(/alternate path/);
  });

  it("output never claims eligibility or appointments", () => {
    const r = evaluateMatch(REQUEST, [center("c-1")], ctx());
    expect(r.disclaimer).toMatch(/Not an insurance eligibility determination/);
    expect(r.requiredStaffActions).toContain("Verify individual benefits and required authorization (not determined by CareFlow)");
  });
});
