import { describe, expect, it } from "vitest";
import { analyzeExperiment, assignVariant, createExperimentSchema } from "../src/experiments";
import { wilsonInterval } from "../src/stats";

const variants = [{ key: "control", allocationPct: 50 }, { key: "treatment", allocationPct: 50 }];

describe("assignment", () => {
  it("is stable and non-reversible", () => {
    const a = assignVariant("salt", "exp-1", "partner-9", variants);
    const b = assignVariant("salt", "exp-1", "partner-9", variants);
    expect(a).toEqual(b);
    expect(a.unitHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.unitHash).not.toContain("partner-9");
    expect(assignVariant("other-salt", "exp-1", "partner-9", variants).unitHash).not.toBe(a.unitHash);
  });
  it("respects allocation over many units", () => {
    const n = 4000;
    const t = Array.from({ length: n }, (_, i) => assignVariant("s", "e", `u${i}`, [{ key: "a", allocationPct: 20 }, { key: "b", allocationPct: 80 }])).filter((x) => x.variant.key === "a").length;
    expect(t / n).toBeGreaterThan(0.17);
    expect(t / n).toBeLessThan(0.23);
  });
});

describe("design validation", () => {
  const base = { centerId: "00000000-0000-4000-8000-000000000001", name: "Test", hypothesis: "A factual packet increases starts.", primaryMetric: "care_starts" };
  it("'none' assignment cannot be randomized", () => {
    expect(createExperimentSchema.safeParse({ ...base, designType: "randomized", assignmentUnit: "none", variants: [{ key: "a", description: "aa", allocationPct: 50 }, { key: "b", description: "bb", allocationPct: 50 }] }).success).toBe(false);
  });
  it("randomized allocations must sum to 100", () => {
    expect(createExperimentSchema.safeParse({ ...base, designType: "randomized", assignmentUnit: "partner", variants: [{ key: "a", description: "aa", allocationPct: 50 }, { key: "b", description: "bb", allocationPct: 40 }] }).success).toBe(false);
  });
  it("defaults to observational", () => {
    expect(createExperimentSchema.parse(base).designType).toBe("observational");
  });
});

describe("analysis honesty", () => {
  const arms = (n: number) => [
    { key: "control", label: "c", units: 6, denominator: n, successes: Math.round(n * 0.2) },
    { key: "treatment", label: "t", units: 6, denominator: n, successes: Math.round(n * 0.3) },
  ];
  const common = { minSamplePerArm: 30, observationDays: 90, typicalDaysToStart: 40, simulated: true, assignmentUnit: "partner" as const };

  it("low N → insufficient evidence, no interval", () => {
    const a = analyzeExperiment({ ...common, designType: "randomized", hasPersistedAssignments: true, arms: arms(10) });
    expect(a.verdict).toBe("insufficient_evidence");
    expect(a.difference?.interval).toBeNull();
  });
  it("randomized label without persisted assignments is not treated as randomized", () => {
    const a = analyzeExperiment({ ...common, designType: "randomized", hasPersistedAssignments: false, arms: arms(200) });
    expect(a.verdict).toBe("descriptive_only");
    expect(a.caveats.join(" ")).toMatch(/no persisted assignments/);
  });
  it("non-randomized never claims causal lift", () => {
    const a = analyzeExperiment({ ...common, designType: "observational", hasPersistedAssignments: false, arms: arms(500), assignmentUnit: "none" });
    expect(a.verdict).toBe("descriptive_only");
    expect(a.difference?.interval).toBeNull();
    expect(a.caveats.join(" ")).toMatch(/No causal lift is claimed/);
  });
  it("adequately powered randomized → ITT estimate with Newcombe interval", () => {
    const a = analyzeExperiment({ ...common, designType: "randomized", hasPersistedAssignments: true, arms: arms(400) });
    expect(a.verdict).toBe("estimate");
    expect(a.difference?.interval?.low).toBeLessThan(a.difference!.absolute!);
    expect(a.caveats[0]).toMatch(/SIMULATED/);
  });
  it("short windows relative to time-to-start are flagged as censored", () => {
    const a = analyzeExperiment({ ...common, observationDays: 14, designType: "randomized", hasPersistedAssignments: true, arms: arms(400) });
    expect(a.verdict).toBe("insufficient_evidence");
  });
  it("Wilson interval matches a reference value", () => {
    const w = wilsonInterval(10, 50)!;
    expect(w.low).toBeCloseTo(0.1124, 3);
    expect(w.high).toBeCloseTo(0.3304, 3);
  });
});
