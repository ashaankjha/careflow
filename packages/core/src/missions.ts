/**
 * Deterministic growth-mission rules (PRD §10). Rules read aggregated,
 * tenant-scoped signals and emit proposals with traceable evidence. An LLM
 * may only paraphrase drafts later — it never changes evidence or triggers
 * execution.
 */
import type { TenantPolicy } from "./policy";
import { round } from "./geo";
import type { AssignmentUnit, DesignType } from "./experiments";

export const MISSION_RULES = {
  M1: "Capacity bottleneck",
  M2: "Underutilized verified capacity",
  M3: "Intake follow-up drag",
  M4: "Benefits workflow stalls",
  M5: "Unexplained funnel loss",
  M6: "Referral gap",
  M7: "Public data / SEO gap",
} as const;
export type MissionRuleId = keyof typeof MISSION_RULES;

export const MISSION_STATUSES = ["proposed", "approved", "rejected", "in_progress", "done"] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const DRAFT_KINDS = ["seo_page", "partner_packet", "referral_email", "internal_plan"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export type StageConversionSignal = {
  stage: string;
  recentEntered: number;
  recentAdvanced: number;
  baselineEntered: number;
  baselineAdvanced: number;
};

export type CenterSignals = {
  centerId: string;
  centerName: string;
  windowDays: number;
  recentInquiries: number;
  /** Median recent inquiries across the organisation's active sites in the same window. */
  peerMedianInquiries: number;
  verifiedHoursAvailable: number | null;
  pendingHours: number;
  matchEvaluated: number;
  matchNotFeasible: number;
  slaEligible: number;
  slaMissed: number;
  benefitsPending: number;
  benefitsStalled: number;
  benefitsStallThresholdDays: number;
  stageConversion: StageConversionSignal[];
  publicProfileStatus: "current" | "outdated" | "missing";
  partnerAttributedStarts: number;
};

export type OrgSignals = {
  partnerStarts: { partnerId: string; partnerName: string; starts: number }[];
  totalPartnerAttributedStarts: number;
};

export type EvidenceItem = {
  metricKey: string;
  label: string;
  numerator: number;
  denominator: number | null;
  timeRange: string;
  eventCount: number;
};

export type MissionProposal = {
  ruleId: MissionRuleId;
  category: string;
  centerId: string;
  title: string;
  explanation: string;
  proposedAction: string;
  guardrail: string;
  expectedDirection: string;
  impactScore: number; // 1..5 bounded directional impact
  confidenceScore: number; // 0..1
  effortScore: number; // 1..5
  priorityScore: number;
  requiresOpsReview: boolean;
  /** True if the action would attract more demand — only allowed with verified unsaturated capacity. */
  increasesDemand: boolean;
  evidence: EvidenceItem[];
  draftKinds: DraftKind[];
  experiment: {
    hypothesis: string;
    primaryMetric: string;
    guardrails: string[];
    assignmentUnit: AssignmentUnit;
    designType: DesignType;
  };
  dedupeKey: string;
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** ISO week key like 2026-W42, used for dedupe (org, center, rule, reporting week). */
export function reportingWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function priority(impact: number, confidence: number, effort: number): number {
  return round((impact * confidence) / Math.max(effort, 1), 3);
}

/** Confidence grows with sample size, bounded to [0.3, 0.9]; never certainty. */
function confidenceFromN(n: number, k = 30): number {
  return round(Math.min(0.9, 0.3 + 0.6 * (n / (n + k))), 2);
}

function hasCapacityHeadroom(c: CenterSignals, policy: TenantPolicy): boolean {
  return c.verifiedHoursAvailable !== null && c.verifiedHoursAvailable >= policy.missions.m2MinVerifiedHours;
}

export function generateMissionProposals(
  centers: CenterSignals[],
  org: OrgSignals,
  policy: TenantPolicy,
  now: Date,
): MissionProposal[] {
  const p = policy.missions;
  const week = reportingWeek(now);
  const range = `last ${p.recentWindowDays} days`;
  const out: MissionProposal[] = [];
  const make = (
    m: Omit<MissionProposal, "priorityScore" | "dedupeKey" | "category"> & { category?: string },
  ): MissionProposal => ({
    ...m,
    category: m.category ?? MISSION_RULES[m.ruleId],
    priorityScore: priority(m.impactScore, m.confidenceScore, m.effortScore),
    dedupeKey: `${m.centerId}:${m.ruleId}:${week}`,
  });

  const m1Flagged = new Set<string>();

  for (const c of centers) {
    const failShare = c.matchEvaluated ? c.matchNotFeasible / c.matchEvaluated : 0;
    const vh = c.verifiedHoursAvailable;

    // M1 — capacity bottleneck
    if (
      c.recentInquiries >= p.m1MinInquiries &&
      ((vh !== null && vh < p.m1MaxVerifiedHours) || vh === null || failShare >= p.m1FailedMatchShare)
    ) {
      m1Flagged.add(c.centerId);
      out.push(
        make({
          ruleId: "M1",
          centerId: c.centerId,
          title: `${c.centerName}: hold demand expansion and resolve staffing capacity`,
          explanation: `${c.recentInquiries} inquiries in the ${range}, but only ${vh ?? "unverified"} verified direct h/wk are available for new starts and ${pct(failShare)} of evaluated inquiries (${c.matchNotFeasible}/${c.matchEvaluated}) had no feasible verified fit at this site.`,
          proposedAction:
            "Run an internal staff deployment / hiring / availability audit (afternoon RBT coverage first). Flag capacity-dependent marketing acceleration as ON HOLD until operations verifies readiness.",
          guardrail: "Never stop responding to existing families; keep waitlist and alternate-path follow-up active.",
          expectedDirection: "↑ capacity-fit rate and verified starts once staffing is verified; ↓ unserviceable closes",
          impactScore: 4,
          confidenceScore: confidenceFromN(c.matchEvaluated),
          effortScore: 4,
          requiresOpsReview: true,
          increasesDemand: false,
          evidence: [
            { metricKey: "inquiries_created", label: "Inquiries created", numerator: c.recentInquiries, denominator: null, timeRange: range, eventCount: c.recentInquiries },
            { metricKey: "verified_weekly_direct_hours_available", label: "Verified direct h/wk available", numerator: vh ?? 0, denominator: null, timeRange: "current snapshot", eventCount: 0 },
            { metricKey: "match_not_feasible_share", label: "No feasible verified fit at site", numerator: c.matchNotFeasible, denominator: c.matchEvaluated, timeRange: range, eventCount: c.matchEvaluated },
          ],
          draftKinds: ["internal_plan"],
          experiment: {
            hypothesis: `Adding verified afternoon RBT coverage at ${c.centerName} increases the share of inquiries with a verified feasible fit and verified care starts.`,
            primaryMetric: "capacity_fit_rate",
            guardrails: ["median_first_response_hours", "close_without_resolution_rate"],
            assignmentUnit: "none",
            designType: "observational",
          },
        }),
      );
    }

    // M3 — intake follow-up drag
    if (c.slaEligible >= p.m3MinN && c.slaMissed / c.slaEligible > p.m3SlaMissShare) {
      const share = c.slaMissed / c.slaEligible;
      out.push(
        make({
          ruleId: "M3",
          centerId: c.centerId,
          title: `${c.centerName}: close the first-response gap`,
          explanation: `${c.slaMissed} of ${c.slaEligible} inquiries (${pct(share)}) in the ${range} had no outreach within the ${policy.firstResponseSlaHours}h SLA.`,
          proposedAction:
            "Route a daily intake queue with named owners, rebalance owner assignments, and adopt a response playbook (draft only — CareFlow never sends messages).",
          guardrail: "No automated family messaging; every outreach remains a staff action.",
          expectedDirection: "↑ response-within-SLA rate; ↑ cohort care-start rate (lagged)",
          impactScore: 3,
          confidenceScore: confidenceFromN(c.slaEligible),
          effortScore: 2,
          requiresOpsReview: false,
          increasesDemand: false,
          evidence: [
            { metricKey: "first_response_sla_miss", label: `No outreach within ${policy.firstResponseSlaHours}h`, numerator: c.slaMissed, denominator: c.slaEligible, timeRange: range, eventCount: c.slaEligible },
          ],
          draftKinds: ["internal_plan"],
          experiment: {
            hypothesis: `A daily owner-routed queue at ${c.centerName} raises the share of inquiries contacted within SLA without lowering cohort start rate.`,
            primaryMetric: "response_within_sla_rate",
            guardrails: ["cohort_start_rate", "close_without_resolution_rate"],
            assignmentUnit: "site_week",
            designType: "quasi_experimental",
          },
        }),
      );
    }

    // M4 — benefits workflow stalls
    if (c.benefitsStalled >= p.m4MinStalled) {
      out.push(
        make({
          ruleId: "M4",
          centerId: c.centerId,
          title: `${c.centerName}: unblock the benefits verification queue`,
          explanation: `${c.benefitsStalled} of ${c.benefitsPending} inquiries in benefits_pending have waited longer than ${c.benefitsStallThresholdDays} days.`,
          proposedAction:
            "Adopt a benefits-verification checklist, assign a human owner per pending request, and work an aging-sorted operational worklist. CareFlow does not determine eligibility.",
          guardrail: "No automated eligibility statements; never send payer cards to an external LLM.",
          expectedDirection: "↓ days in benefits_pending; ↑ stage conversion to benefits_verified",
          impactScore: 4,
          confidenceScore: confidenceFromN(c.benefitsPending),
          effortScore: 2,
          requiresOpsReview: false,
          increasesDemand: false,
          evidence: [
            { metricKey: "stall_rate.benefits_pending", label: `Pending > ${c.benefitsStallThresholdDays} days`, numerator: c.benefitsStalled, denominator: c.benefitsPending, timeRange: "current snapshot", eventCount: c.benefitsPending },
          ],
          draftKinds: ["internal_plan"],
          experiment: {
            hypothesis: `A structured benefits checklist with named owners at ${c.centerName} shortens benefits_pending duration.`,
            primaryMetric: "median_days_in_benefits_pending",
            guardrails: ["close_without_resolution_rate", "median_first_response_hours"],
            assignmentUnit: "none",
            designType: "observational",
          },
        }),
      );
    }

    // M5 — unexplained funnel loss vs own baseline
    for (const s of c.stageConversion) {
      if (s.recentEntered < p.m5MinN || s.baselineEntered < p.m5MinN) continue;
      const recent = s.recentAdvanced / s.recentEntered;
      const base = s.baselineAdvanced / s.baselineEntered;
      if (base - recent >= p.m5DropPoints) {
        out.push(
          make({
            ruleId: "M5",
            centerId: c.centerId,
            title: `${c.centerName}: investigate drop after "${s.stage}"`,
            explanation: `Conversion from ${s.stage} fell to ${pct(recent)} (${s.recentAdvanced}/${s.recentEntered}) versus a ${pct(base)} baseline (${s.baselineAdvanced}/${s.baselineEntered}).`,
            proposedAction:
              "Propose a limited intake UX/workflow experiment with explicit guardrails and no reduction in informational accuracy.",
            guardrail: "Equivalent factual content in all arms; never randomize access, priority, or verification.",
            expectedDirection: "↑ stage conversion back toward baseline",
            impactScore: 2,
            confidenceScore: confidenceFromN(Math.min(s.recentEntered, s.baselineEntered)),
            effortScore: 3,
            requiresOpsReview: false,
            increasesDemand: false,
            evidence: [
              { metricKey: `stage_conversion.${s.stage}.recent`, label: "Recent conversion", numerator: s.recentAdvanced, denominator: s.recentEntered, timeRange: range, eventCount: s.recentEntered },
              { metricKey: `stage_conversion.${s.stage}.baseline`, label: "Baseline conversion", numerator: s.baselineAdvanced, denominator: s.baselineEntered, timeRange: "prior baseline window", eventCount: s.baselineEntered },
            ],
            draftKinds: ["internal_plan"],
            experiment: {
              hypothesis: `A clearer ${s.stage} next-step workflow restores conversion without reducing accuracy.`,
              primaryMetric: `stage_conversion.${s.stage}`,
              guardrails: ["median_first_response_hours", "close_without_resolution_rate"],
              assignmentUnit: "site_week",
              designType: "quasi_experimental",
            },
          }),
        );
        break; // one M5 per center per week
      }
    }
  }

  // Demand-increasing rules: only for centers with verified, unsaturated capacity and no M1 flag.
  for (const c of centers) {
    if (m1Flagged.has(c.centerId) || !hasCapacityHeadroom(c, policy)) continue;
    const vh = c.verifiedHoursAvailable!;
    const belowBaseline = c.recentInquiries < c.peerMedianInquiries * p.m2BelowBaselineRatio;

    if (belowBaseline) {
      out.push(
        make({
          ruleId: "M2",
          centerId: c.centerId,
          title: `${c.centerName}: connect families to verified open capacity`,
          explanation: `${vh} verified direct h/wk are available for new starts, while the site received ${c.recentInquiries} inquiries in the ${range} versus a peer-site median of ${c.peerMedianInquiries}.`,
          proposedAction:
            "Launch a localized information campaign and a factual referral packet for professional contacts describing only verified services, payers and service area.",
          guardrail: "Ops must approve availability and payer details before anything is shared; no wait-time promises.",
          expectedDirection: "↑ qualified inquiries and verified starts at this site (incremental vs comparison)",
          impactScore: 4,
          confidenceScore: confidenceFromN(c.recentInquiries + 10),
          effortScore: 2,
          requiresOpsReview: true,
          increasesDemand: true,
          evidence: [
            { metricKey: "verified_weekly_direct_hours_available", label: "Verified direct h/wk available", numerator: vh, denominator: null, timeRange: "current snapshot", eventCount: 0 },
            { metricKey: "inquiries_created", label: "Inquiries at site", numerator: c.recentInquiries, denominator: null, timeRange: range, eventCount: c.recentInquiries },
            { metricKey: "peer_median_inquiries", label: "Peer-site median inquiries", numerator: c.peerMedianInquiries, denominator: null, timeRange: range, eventCount: 0 },
          ],
          draftKinds: ["partner_packet", "referral_email", "internal_plan"],
          experiment: {
            hypothesis: `Sharing an accurate referral packet with professional partners near ${c.centerName} increases verified care starts at the site.`,
            primaryMetric: "care_starts",
            guardrails: ["median_first_response_hours", "close_without_resolution_rate", "capacity_fit_rate"],
            assignmentUnit: "partner",
            designType: "randomized",
          },
        }),
      );
    }

    // M6 — referral gap
    const top = [...org.partnerStarts].sort((a, b) => b.starts - a.starts || a.partnerId.localeCompare(b.partnerId))[0];
    if (
      top &&
      org.totalPartnerAttributedStarts >= p.m6MinAttributedStarts &&
      top.starts / org.totalPartnerAttributedStarts >= p.m6ConcentrationShare &&
      c.partnerAttributedStarts <= 1
    ) {
      out.push(
        make({
          ruleId: "M6",
          centerId: c.centerId,
          title: `${c.centerName}: diversify professional referral relationships`,
          explanation: `${top.starts} of ${org.totalPartnerAttributedStarts} partner-attributed starts (${pct(top.starts / org.totalPartnerAttributedStarts)}) came from one relationship (${top.partnerName}), while ${c.centerName} has ${vh} verified direct h/wk and ${c.partnerAttributedStarts} partner-attributed starts.`,
          proposedAction:
            "Build a professional contact research list from public listings near the site and prepare a factual referral packet. No gifts, pay-per-referral or incentives; nothing is sent without review.",
          guardrail: "Anti-kickback: no remuneration for referrals; professional contacts only, never families.",
          expectedDirection: "↑ partner-attributed inquiries at this site; ↓ concentration risk",
          impactScore: 3,
          confidenceScore: confidenceFromN(org.totalPartnerAttributedStarts),
          effortScore: 3,
          requiresOpsReview: true,
          increasesDemand: true,
          evidence: [
            { metricKey: "referral_concentration", label: `Starts from ${top.partnerName}`, numerator: top.starts, denominator: org.totalPartnerAttributedStarts, timeRange: range, eventCount: org.totalPartnerAttributedStarts },
            { metricKey: "verified_weekly_direct_hours_available", label: "Verified direct h/wk available", numerator: vh, denominator: null, timeRange: "current snapshot", eventCount: 0 },
          ],
          draftKinds: ["partner_packet", "referral_email"],
          experiment: {
            hypothesis: `New professional relationships near ${c.centerName} increase partner-attributed qualified inquiries.`,
            primaryMetric: "partner_attributed_inquiries",
            guardrails: ["close_without_resolution_rate"],
            assignmentUnit: "partner",
            designType: "observational",
          },
        }),
      );
    }

    // M7 — public factual content gap
    if (c.publicProfileStatus !== "current") {
      out.push(
        make({
          ruleId: "M7",
          centerId: c.centerId,
          title: `${c.centerName}: publish an accurate location page`,
          explanation: `Public location content is ${c.publicProfileStatus} while the site has ${vh} verified direct h/wk and verified payer participation on record.`,
          proposedAction:
            "Draft one high-quality location page from human-verified hours, payers, address and service modes, with genuinely useful FAQs. Local preview only; no auto-publishing.",
          guardrail: "No doorway pages, fake reviews, invented wait times or outcome guarantees.",
          expectedDirection: "↑ local-search inquiries at this site (observational)",
          impactScore: 2,
          confidenceScore: 0.5,
          effortScore: 2,
          requiresOpsReview: true,
          increasesDemand: true,
          evidence: [
            { metricKey: "public_profile_status", label: `Public profile: ${c.publicProfileStatus}`, numerator: c.publicProfileStatus === "missing" ? 0 : 1, denominator: 1, timeRange: "current snapshot", eventCount: 0 },
            { metricKey: "verified_weekly_direct_hours_available", label: "Verified direct h/wk available", numerator: vh, denominator: null, timeRange: "current snapshot", eventCount: 0 },
          ],
          draftKinds: ["seo_page"],
          experiment: {
            hypothesis: `An accurate location page for ${c.centerName} increases local-search inquiries.`,
            primaryMetric: "inquiries_created.local_search",
            guardrails: ["close_without_resolution_rate"],
            assignmentUnit: "none",
            designType: "observational",
          },
        }),
      );
    }
  }

  // Final invariant: never advocate demand for unverified / saturated capacity.
  const centerById = new Map(centers.map((c) => [c.centerId, c]));
  return out
    .filter((m) => !m.increasesDemand || (hasCapacityHeadroom(centerById.get(m.centerId)!, policy) && !m1Flagged.has(m.centerId)))
    .sort((a, b) => b.priorityScore - a.priorityScore || a.dedupeKey.localeCompare(b.dedupeKey));
}
