import { z } from "zod";

/**
 * Tenant-configurable operational policy. Stored in organizations.settings and
 * merged with these defaults. All thresholds are explicit so mission rules and
 * metrics can cite them in evidence.
 */
export const tenantPolicySchema = z.object({
  firstResponseSlaHours: z.number().positive().default(24),
  payerVerificationMaxAgeDays: z.number().int().positive().default(180),
  capacityVerificationMaxAgeDays: z.number().int().positive().default(30),
  planningDefaultDirectHours: z.number().positive().default(10),
  stallThresholdDays: z
    .record(z.string(), z.number().positive())
    .default({
      new: 2,
      contacted: 5,
      qualified: 7,
      benefits_pending: 10,
      benefits_verified: 7,
      assessment_pending: 14,
      authorization_pending: 21,
      ready_to_start: 10,
      waitlisted: 30,
    }),
  minCellSize: z.number().int().positive().default(5),
  minPopulationToRank: z.number().int().positive().default(500),
  experimentMinSamplePerArm: z.number().int().positive().default(30),
  missions: z
    .object({
      recentWindowDays: z.number().int().positive().default(30),
      m1MinInquiries: z.number().int().positive().default(10),
      m1MaxVerifiedHours: z.number().nonnegative().default(5),
      m1FailedMatchShare: z.number().min(0).max(1).default(0.5),
      m2MinVerifiedHours: z.number().nonnegative().default(25),
      m2BelowBaselineRatio: z.number().positive().default(0.8),
      m3MinN: z.number().int().positive().default(10),
      m3SlaMissShare: z.number().min(0).max(1).default(0.3),
      m4MinStalled: z.number().int().positive().default(5),
      m5MinN: z.number().int().positive().default(15),
      m5DropPoints: z.number().positive().default(0.2),
      m6ConcentrationShare: z.number().min(0).max(1).default(0.4),
      m6MinAttributedStarts: z.number().int().positive().default(4),
    })
    .default({}),
});

export type TenantPolicy = z.infer<typeof tenantPolicySchema>;

export function resolvePolicy(settings: unknown): TenantPolicy {
  const parsed = tenantPolicySchema.safeParse(settings ?? {});
  return parsed.success ? parsed.data : tenantPolicySchema.parse({});
}

export const DEFAULT_POLICY: TenantPolicy = tenantPolicySchema.parse({});
