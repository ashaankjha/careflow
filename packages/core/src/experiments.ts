import { createHmac } from "node:crypto";
import { z } from "zod";
import { newcombeDiffInterval, safeRate, wilsonInterval } from "./stats";

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

export type ArmOutcome = { key: string; label: string; units: number; denominator: number; successes: number };

export type ExperimentAnalysis = {
  verdict: "insufficient_evidence" | "descriptive_only" | "estimate";
  verdictLabel: string;
  arms: (ArmOutcome & { rate: number | null; interval: { low: number; high: number } | null })[];
  difference: { absolute: number | null; relative: number | null; interval: { low: number; high: number } | null } | null;
  caveats: string[];
};

/**
 * Honest analysis: randomized + adequate N => intention-to-treat estimate with
 * Wilson/Newcombe intervals. Anything else => descriptive or insufficient.
 * Never declares significance; never auto-stops.
 */
export function analyzeExperiment(input: {
  designType: DesignType;
  hasPersistedAssignments: boolean;
  arms: ArmOutcome[];
  minSamplePerArm: number;
  observationDays: number;
  typicalDaysToStart: number | null;
  simulated: boolean;
  assignmentUnit: AssignmentUnit;
}): ExperimentAnalysis {
  const caveats: string[] = [];
  if (input.simulated) caveats.push("SIMULATED: outcomes come from synthetic demo events, not measured live results.");
  const arms = input.arms.map((a) => ({
    ...a,
    rate: safeRate(a.successes, a.denominator),
    interval: wilsonInterval(a.successes, a.denominator),
  }));
  const randomized = input.designType === "randomized" && input.hasPersistedAssignments;
  if (input.designType === "randomized" && !input.hasPersistedAssignments) {
    caveats.push("Labelled randomized but no persisted assignments exist — treated as observational.");
  }
  if (!randomized) {
    caveats.push(
      "Non-randomized comparison: seasonal, staffing, payer-mix and referral-pattern confounding are likely. No causal lift is claimed.",
    );
  }
  if (input.assignmentUnit === "partner" || input.assignmentUnit === "site_week") {
    caveats.push(
      `Randomized by ${input.assignmentUnit.replace("_", "-")}, outcomes counted per inquiry: intervals ignore clustering and are optimistic.`,
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

  let difference: ExperimentAnalysis["difference"] = null;
  if (arms.length >= 2) {
    const [t, c] = [arms[1]!, arms[0]!]; // arms[0] = control/baseline
    if (t.rate !== null && c.rate !== null) {
      difference = {
        absolute: t.rate - c.rate,
        relative: c.rate > 0 ? (t.rate - c.rate) / c.rate : null,
        interval:
          randomized && !lowN ? newcombeDiffInterval(t.successes, t.denominator, c.successes, c.denominator) : null,
      };
    }
  }
  const verdict: ExperimentAnalysis["verdict"] =
    lowN || shortWindow ? "insufficient_evidence" : randomized ? "estimate" : "descriptive_only";
  const verdictLabel =
    verdict === "insufficient_evidence"
      ? "Insufficient evidence"
      : verdict === "estimate"
        ? "Intention-to-treat estimate (with uncertainty)"
        : "Descriptive only — not causal";
  return { verdict, verdictLabel, arms, difference, caveats };
}
