import { createHmac } from "node:crypto";
import { z } from "zod";
import { clusterDiffInterval, clusterRateInterval, newcombeDiffInterval, safeRate, wilsonInterval, type ClusterCount } from "./stats";

export const ASSIGNMENT_UNITS = ["partner", "site_week", "page_session", "none"] as const;
export const DESIGN_TYPES = ["randomized", "quasi_experimental", "observational"] as const;
export const EXPERIMENT_STATUSES = ["draft", "active", "completed", "cancelled"] as const;
export type AssignmentUnit = (typeof ASSIGNMENT_UNITS)[number];
export type DesignType = (typeof DESIGN_TYPES)[number];

export const createExperimentSchema = z
  .object({
    centerId: z.string().uuid(),
    missionId: z.string().uuid().nullable().optional(),
    name: z.string().trim().min(3).max(120),
    hypothesis: z.string().trim().min(10).max(1000),
    primaryMetric: z.string().trim().min(3).max(80),
    guardrailMetrics: z.array(z.string().trim().min(2).max(80)).max(6).default([]),
    assignmentUnit: z.enum(ASSIGNMENT_UNITS).default("none"),
    designType: z.enum(DESIGN_TYPES).default("observational"),
    baselineDays: z.number().int().min(7).max(365).default(60),
    plannedDurationDays: z.number().int().min(7).max(365).default(56),
    variants: z
      .array(
        z.object({
          key: z.string().trim().min(1).max(24),
          description: z.string().trim().min(2).max(200),
          allocationPct: z.number().min(0).max(100),
        }),
      )
      .max(4)
      .default([]),
  })
  .superRefine((v, ctx) => {
    if (v.designType === "randomized") {
      if (v.assignmentUnit === "none")
        ctx.addIssue({ code: "custom", path: ["designType"], message: "Assignment unit 'none' cannot be randomized" });
      if (v.variants.length < 2)
        ctx.addIssue({ code: "custom", path: ["variants"], message: "Randomized designs need at least 2 variants" });
      const sum = v.variants.reduce((s, x) => s + x.allocationPct, 0);
      if (Math.abs(sum - 100) > 0.001)
        ctx.addIssue({ code: "custom", path: ["variants"], message: `Allocations must sum to 100 (got ${sum})` });
    }
  });
export type CreateExperimentInput = z.infer<typeof createExperimentSchema>;

/** Non-reversible, stable unit hash for assignment storage. */
export function unitHmac(salt: string, experimentId: string, unitId: string): string {
  return createHmac("sha256", salt).update(`${experimentId}:${unitId}`).digest("hex");
}

/**
 * Stable assignment: HMAC(salt, experimentId + unit) mapped into the cumulative
 * allocation. Same inputs always yield the same variant.
 */
export function assignVariant<V extends { key: string; allocationPct: number }>(
  salt: string,
  experimentId: string,
  unitId: string,
  variants: V[],
): { variant: V; unitHash: string } {
  if (variants.length === 0) throw new Error("No variants");
  const unitHash = unitHmac(salt, experimentId, unitId);
  const bucket = (parseInt(unitHash.slice(0, 8), 16) / 0xffffffff) * 100;
  let acc = 0;
  for (const v of variants) {
    acc += v.allocationPct;
    if (bucket < acc) return { variant: v, unitHash };
  }
  return { variant: variants[variants.length - 1]!, unitHash };
}

/**
 * Minimum number of clusters (partners or site-weeks) with at least one
 * observation required in every arm before a cluster-randomized experiment
 * reports a difference interval. Below ~10 clusters per arm cluster-robust
 * standard errors are unreliable, so the verdict stays "insufficient evidence".
 */
export const MIN_CLUSTERS_PER_ARM = 10;

export const CLUSTER_UNITS: readonly AssignmentUnit[] = ["partner", "site_week"];

/**
 * Outcome counts for one arm. For cluster-randomized designs `clusters` holds
 * the per-unit (partner / site-week) counts so uncertainty can respect the unit
 * of randomization; individually randomized arms omit it.
 */
export type ArmOutcome = { key: string; label: string; units: number; denominator: number; successes: number; clusters?: ClusterCount[] };

export type IntervalMethod = "wilson_newcombe" | "cluster_robust";

export type ExperimentAnalysis = {
  verdict: "insufficient_evidence" | "descriptive_only" | "estimate";
  verdictLabel: string;
  intervalMethod: IntervalMethod;
  minClustersPerArm: number | null;
  arms: (Omit<ArmOutcome, "clusters"> & {
    rate: number | null;
    interval: { low: number; high: number } | null;
    /** Clusters with ≥1 observation (cluster-randomized designs only). */
    clustersWithData: number | null;
    designEffect: number | null;
  })[];
  difference: { absolute: number | null; relative: number | null; interval: { low: number; high: number } | null; df: number | null } | null;
  caveats: string[];
};

/**
 * Honest analysis: randomized + adequate N => intention-to-treat estimate.
 * Individually randomized: Wilson per arm, Newcombe for the difference.
 * Cluster-randomized (partner / site-week): cluster-robust ratio intervals with
 * t critical values over the clusters, and "insufficient evidence" until every
 * arm has `minClustersPerArm` clusters with data. Anything else => descriptive
 * or insufficient. Never declares significance; never auto-stops.
 */
export function analyzeExperiment(input: {
  designType: DesignType;
  hasPersistedAssignments: boolean;
  arms: ArmOutcome[];
  minSamplePerArm: number;
  minClustersPerArm?: number;
  observationDays: number;
  typicalDaysToStart: number | null;
  simulated: boolean;
  assignmentUnit: AssignmentUnit;
}): ExperimentAnalysis {
  const caveats: string[] = [];
  if (input.simulated) caveats.push("SIMULATED: outcomes come from synthetic demo events, not measured live results.");
  const randomized = input.designType === "randomized" && input.hasPersistedAssignments;
  const clustered = randomized && CLUSTER_UNITS.includes(input.assignmentUnit);
  const minClusters = input.minClustersPerArm ?? MIN_CLUSTERS_PER_ARM;
  const arms = input.arms.map(({ clusters, ...a }) => {
    const rate = safeRate(a.successes, a.denominator);
    if (!clustered) return { ...a, rate, interval: wilsonInterval(a.successes, a.denominator), clustersWithData: null, designEffect: null };
    const cr = clusters ? clusterRateInterval(clusters) : null;
    return {
      ...a,
      rate,
      interval: cr ? { low: cr.low, high: cr.high } : null,
      clustersWithData: clusters ? clusters.filter((c) => c.denominator > 0).length : 0,
      designEffect: cr?.designEffect ?? null,
    };
  });
  if (input.designType === "randomized" && !input.hasPersistedAssignments) {
    caveats.push("Labelled randomized but no persisted assignments exist — treated as observational.");
  }
  if (!randomized) {
    caveats.push(
      "Non-randomized comparison: seasonal, staffing, payer-mix and referral-pattern confounding are likely. No causal lift is claimed.",
    );
  }
  const unitName = input.assignmentUnit === "partner" ? "partners" : "site-weeks";
  if (clustered) {
    caveats.push(
      `Randomized by ${input.assignmentUnit.replace("_", "-")}: intervals are cluster-robust over ${unitName} (pooled-rate ratio estimator, t critical value on clusters − 1 df, never narrower than the per-inquiry interval). With few clusters they remain approximate.`,
    );
  }
  const shortWindow = input.typicalDaysToStart !== null && input.observationDays < input.typicalDaysToStart;
  if (shortWindow) {
    caveats.push(
      `Observation window (${input.observationDays} d) is shorter than the typical inquiry-to-start time (${Math.round(input.typicalDaysToStart!)} d): starts are right-censored.`,
    );
  }
  const lowN = arms.some((a) => a.denominator < input.minSamplePerArm);
  if (lowN) caveats.push(`Fewer than ${input.minSamplePerArm} observations in at least one arm (configured minimum).`);
  const lowClusters = clustered && arms.some((a) => (a.clustersWithData ?? 0) < minClusters);
  if (lowClusters) {
    caveats.push(
      `Fewer than ${minClusters} ${unitName} with data in at least one arm (${arms.map((a) => `${a.key}: ${a.clustersWithData ?? 0}`).join(", ")}): cluster-level uncertainty cannot be estimated reliably.`,
    );
  }

  let difference: ExperimentAnalysis["difference"] = null;
  if (arms.length >= 2) {
    const [t, c] = [arms[1]!, arms[0]!]; // arms[0] = control/baseline
    if (t.rate !== null && c.rate !== null) {
      let interval: { low: number; high: number } | null = null;
      let df: number | null = null;
      if (randomized && !lowN && !lowClusters) {
        if (clustered) {
          const cd = clusterDiffInterval(input.arms[1]!.clusters ?? [], input.arms[0]!.clusters ?? []);
          if (cd) {
            interval = { low: cd.low, high: cd.high };
            df = cd.df;
          }
        } else {
          interval = newcombeDiffInterval(t.successes, t.denominator, c.successes, c.denominator);
        }
      }
      difference = { absolute: t.rate - c.rate, relative: c.rate > 0 ? (t.rate - c.rate) / c.rate : null, interval, df };
    }
  }
  const verdict: ExperimentAnalysis["verdict"] =
    lowN || shortWindow || lowClusters || (randomized && !difference?.interval)
      ? "insufficient_evidence"
      : randomized
        ? "estimate"
        : "descriptive_only";
  const verdictLabel =
    verdict === "insufficient_evidence"
      ? "Insufficient evidence"
      : verdict === "estimate"
        ? "Intention-to-treat estimate (with uncertainty)"
        : "Descriptive only — not causal";
  return {
    verdict,
    verdictLabel,
    intervalMethod: clustered ? "cluster_robust" : "wilson_newcombe",
    minClustersPerArm: clustered ? minClusters : null,
    arms,
    difference,
    caveats,
  };
}
