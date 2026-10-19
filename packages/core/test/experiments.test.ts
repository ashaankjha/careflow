import { describe, expect, it } from "vitest";
import { analyzeExperiment, assignVariant, createExperimentSchema, MIN_CLUSTERS_PER_ARM } from "../src/experiments";
import { clusterDiffInterval, clusterRateInterval, clusterRatioVariance, newcombeDiffInterval, studentTQuantile, wilsonInterval } from "../src/stats";

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
  it("adequately powered individually randomized → ITT estimate with Newcombe interval", () => {
    const a = analyzeExperiment({ ...common, assignmentUnit: "page_session", designType: "randomized", hasPersistedAssignments: true, arms: arms(400) });
    expect(a.verdict).toBe("estimate");
    expect(a.intervalMethod).toBe("wilson_newcombe");
    expect(a.difference?.interval).toEqual(newcombeDiffInterval(120, 400, 80, 400));
    expect(a.difference?.interval?.low).toBeLessThan(a.difference!.absolute!);
    expect(a.caveats[0]).toMatch(/SIMULATED/);
  });
  it("short windows relative to time-to-start are flagged as censored", () => {
    const a = analyzeExperiment({ ...common, assignmentUnit: "page_session", observationDays: 14, designType: "randomized", hasPersistedAssignments: true, arms: arms(400) });
    expect(a.verdict).toBe("insufficient_evidence");
  });
  it("Wilson interval matches a reference value", () => {
    const w = wilsonInterval(10, 50)!;
    expect(w.low).toBeCloseTo(0.1124, 3);
    expect(w.high).toBeCloseTo(0.3304, 3);
  });
});

describe("Student-t critical values", () => {
  it.each([
    [1, 12.7062],
    [2, 4.3027],
    [4, 2.7764],
    [9, 2.2622],
    [29, 2.0452],
  ])("t(0.975, df=%i) = %f", (df, q) => {
    expect(studentTQuantile(0.95, df)).toBeCloseTo(q, 3);
  });
  it("approaches the normal value for large df", () => {
    expect(studentTQuantile(0.95, 100000)).toBeCloseTo(1.96, 2);
  });
});

describe("cluster-robust intervals (known answers)", () => {
  const c = (succ: number[], n = 10) => succ.map((s) => ({ successes: s, denominator: n }));
  // Arm A: 2,4,6,3,5 of 10 → p = 0.4, residuals −2,0,2,−1,1 → Σe² = 10, V = 5/4·10/50² = 0.005
  // Arm B: 1,2,1,3,2 of 10 → p = 0.18, Σe² = 2.8, V = 5/4·2.8/50² = 0.0014
  it("ratio-estimator variance", () => {
    expect(clusterRatioVariance(c([2, 4, 6, 3, 5]))).toMatchObject({ rate: 0.4, clusters: 5, n: 50 });
    expect(clusterRatioVariance(c([2, 4, 6, 3, 5]))!.variance).toBeCloseTo(0.005, 12);
    expect(clusterRatioVariance(c([1, 2, 1, 3, 2]))!.variance).toBeCloseTo(0.0014, 12);
  });
  it("drops empty clusters and needs at least two informative clusters", () => {
    expect(clusterRatioVariance([...c([2, 4]), { successes: 0, denominator: 0 }])!.clusters).toBe(2);
    expect(clusterRatioVariance([{ successes: 3, denominator: 10 }, { successes: 0, denominator: 0 }])).toBeNull();
  });
  it("difference: 0.22 ± t(4)·0.08 = [−0.0021, 0.4421]", () => {
    const d = clusterDiffInterval(c([2, 4, 6, 3, 5]), c([1, 2, 1, 3, 2]))!;
    expect(d.df).toBe(4);
    expect(d.low).toBeCloseTo(0.22 - 2.776445 * 0.08, 5);
    expect(d.high).toBeCloseTo(0.22 + 2.776445 * 0.08, 5);
    // wider than the per-inquiry Newcombe interval on the same totals
    const nc = newcombeDiffInterval(20, 50, 9, 50)!;
    expect(d.low).toBeLessThan(nc.low);
    expect(d.high).toBeGreaterThan(nc.high);
  });
  it("one arm: 0.4 ± t(2)·√(12/900), clamped at 0, design effect 5/3", () => {
    const r = clusterRateInterval(c([2, 4, 6]))!;
    expect(r.low).toBe(0);
    expect(r.high).toBeCloseTo(0.4 + 4.302653 * Math.sqrt(12 / 900), 5);
    expect(r.designEffect).toBeCloseTo(5 / 3, 10);
  });
  it("is never narrower than the per-inquiry Wilson interval (homogeneous clusters)", () => {
    const r = clusterRateInterval(c([3, 3, 3, 3]))!;
    const w = wilsonInterval(12, 40)!;
    expect(r.low).toBeCloseTo(w.low, 12);
    expect(r.high).toBeCloseTo(w.high, 12);
  });
});

describe("cluster-randomized analysis", () => {
  const common = { minSamplePerArm: 30, observationDays: 90, typicalDaysToStart: 40, simulated: true, designType: "randomized" as const, hasPersistedAssignments: true };
  const arm = (key: string, succ: number[], n = 10) => ({
    key,
    label: key,
    units: succ.length,
    denominator: succ.length * n,
    successes: succ.reduce((a, b) => a + b, 0),
    clusters: succ.map((s) => ({ successes: s, denominator: n })),
  });
  const control = [1, 2, 1, 3, 2, 2, 1, 3, 2, 1, 2, 2];
  const treat = [2, 4, 6, 3, 5, 4, 3, 5, 4, 3, 4, 5];

  it("enough clusters → estimate with cluster-robust interval and cluster counts", () => {
    const a = analyzeExperiment({ ...common, assignmentUnit: "partner", arms: [arm("control", control), arm("treatment", treat)] });
    expect(a.verdict).toBe("estimate");
    expect(a.intervalMethod).toBe("cluster_robust");
    expect(a.arms.map((x) => x.clustersWithData)).toEqual([12, 12]);
    expect(a.difference!.df).toBe(11);
    expect(a.difference!.interval).toEqual(
      (({ low, high }) => ({ low, high }))(clusterDiffInterval(arm("t", treat).clusters, arm("c", control).clusters)!),
    );
    expect(a.caveats.join(" ")).toMatch(/cluster-robust over partners/);
    expect(a.caveats.join(" ")).not.toMatch(/ignore clustering/);
  });
  it("fewer than the minimum clusters per arm → insufficient evidence even with large N", () => {
    const a = analyzeExperiment({ ...common, assignmentUnit: "partner", arms: [arm("control", [10, 20, 30], 100), arm("treatment", [20, 30, 40], 100)] });
    expect(a.verdict).toBe("insufficient_evidence");
    expect(a.difference?.interval).toBeNull();
    expect(a.minClustersPerArm).toBe(MIN_CLUSTERS_PER_ARM);
    expect(a.caveats.join(" ")).toMatch(/Fewer than 10 partners with data/);
  });
  it("empty clusters do not count toward the minimum", () => {
    const pad = (xs: number[]) => [...arm("x", xs).clusters, ...Array.from({ length: 8 }, () => ({ successes: 0, denominator: 0 }))];
    const a = analyzeExperiment({
      ...common,
      assignmentUnit: "site_week",
      arms: [{ ...arm("control", [5, 6, 7], 20), clusters: pad([5, 6, 7]) }, { ...arm("treatment", [8, 9, 10], 20), clusters: pad([8, 9, 10]) }],
    });
    expect(a.arms.map((x) => x.clustersWithData)).toEqual([3, 3]);
    expect(a.verdict).toBe("insufficient_evidence");
    expect(a.caveats.join(" ")).toMatch(/site-weeks with data/);
  });
  it("minimum is configurable", () => {
    const a = analyzeExperiment({ ...common, minSamplePerArm: 10, minClustersPerArm: 3, assignmentUnit: "partner", arms: [arm("control", [1, 2, 3, 2]), arm("treatment", [3, 4, 5, 4])] });
    expect(a.verdict).toBe("estimate");
  });
  it("missing cluster data for a cluster unit → insufficient, never a naive interval", () => {
    const { clusters: _c, ...noClusters } = arm("control", control);
    const { clusters: _t, ...noClustersT } = arm("treatment", treat);
    const a = analyzeExperiment({ ...common, assignmentUnit: "partner", arms: [noClusters, noClustersT] });
    expect(a.verdict).toBe("insufficient_evidence");
    expect(a.difference?.interval).toBeNull();
    expect(a.arms.every((x) => x.interval === null)).toBe(true);
  });
});
