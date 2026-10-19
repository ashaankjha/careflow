/**
 * Capacity-aware, explainable center matching (PRD §8).
 *
 * Pure and deterministic: identical inputs always yield identical output.
 * Output describes *potential operational fit* only. It never asserts
 * insurance eligibility, clinical appropriateness, or a bookable slot.
 */
import { haversineMiles, round } from "./geo";
import type { TenantPolicy } from "./policy";
import type { MatchRequest, PayerStatus, ServiceMode, StaffRole } from "./schemas";

export type GateKey =
  | "geography"
  | "payer"
  | "service_mode"
  | "age_policy"
  | "rbt_schedule"
  | "bcba_supervision"
  | "new_start_limit";

export type GateStatus = "pass" | "fail" | "verification_needed" | "not_applicable";
export type Gate = { key: GateKey; label: string; status: GateStatus; reason: string };
export type Eligibility = "potential_fit" | "verification_needed" | "not_feasible";

export type MatchCenter = {
  id: string;
  name: string;
  active: boolean;
  latitude: number | null;
  longitude: number | null;
  serviceModes: ServiceMode[];
  serviceRadiusMiles: number;
  acceptedAgeMin: number | null;
  acceptedAgeMax: number | null;
  payers: { payerId: string; status: PayerStatus; lastVerifiedAt: Date | null }[];
  windows: {
    role: StaffRole;
    dayOfWeek: number;
    startMinute: number;
    endMinute: number;
    weeklyAvailableHours: number;
    serviceMode: ServiceMode;
    verifiedAt: Date | null;
  }[];
  rules: {
    payerId: string | null;
    requiredBcbaHoursPerDirectHour: number | null;
    maxNewStartsPerWeek: number | null;
    isVerified: boolean;
  }[];
  /** Non-expired holds with status proposed or reserved (conservatively subtracted). */
  holds: { directWeeklyHours: number; bcbaWeeklyHours: number }[];
  startsLast7Days: number;
  /** Inquiries currently in onboarding stages (benefits_pending..ready_to_start) at this site. */
  onboardingBacklog: number;
};

export type MatchContext = {
  now: Date;
  policy: TenantPolicy;
  /** Centroid of the requested ZCTA, or null if unknown. */
  zcta: { lat: number; lng: number } | null;
  payerName?: string | null;
};

export type ScoreComponents = { schedule: number; capacity: number; distance: number; backlog: number };

export type CenterMatch = {
  centerId: string;
  centerName: string;
  eligibility: Eligibility;
  score: number | null;
  distanceMiles: number | null;
  capacityEvidenceAt: string | null;
  gates: Gate[];
  scoreComponents: ScoreComponents | null;
  capacity: {
    requestedHours: number;
    requestedHoursAssumed: boolean;
    verifiedRbtOverlapHours: number;
    unverifiedRbtOverlapHours: number;
    verifiedRbtTotalHours: number;
    heldDirectHours: number;
    bcbaRequiredHours: number | null;
    bcbaAvailableHours: number;
  };
  staffActions: string[];
};

export type MatchResult = {
  status: "potential_fit" | "verification_needed" | "no_feasible_match";
  matches: CenterMatch[];
  requiredStaffActions: string[];
  evaluatedAt: string;
  disclaimer: string;
};

export const SCORE_WEIGHTS = { schedule: 0.35, capacity: 0.25, distance: 0.2, backlog: 0.2 } as const;

export const MATCH_DISCLAIMER =
  "Potential operational fit only. Not an insurance eligibility determination, clinical recommendation, or appointment. Staff must verify benefits, authorization, and scheduling.";

const DAY_MS = 86_400_000;

function ageDays(now: Date, d: Date | null): number | null {
  return d ? Math.floor((now.getTime() - d.getTime()) / DAY_MS) : null;
}

function overlapMinutes(a: { startMinute: number; endMinute: number }, b: { startMinute: number; endMinute: number }) {
  return Math.max(0, Math.min(a.endMinute, b.endMinute) - Math.max(a.startMinute, b.startMinute));
}

function isWindowVerified(w: MatchCenter["windows"][number], ctx: MatchContext): boolean {
  const age = ageDays(ctx.now, w.verifiedAt);
  return age !== null && age <= ctx.policy.capacityVerificationMaxAgeDays && age >= 0;
}

/**
 * Hours from capacity windows attributable to family windows. Available hours are
 * assumed spread uniformly across each staff window (documented approximation).
 * Windows of the same role/day/mode are validated as non-overlapping on save, so
 * summation never double counts.
 */
function overlapHours(
  family: MatchRequest["preferredWindows"],
  windows: MatchCenter["windows"],
): number {
  let total = 0;
  for (const f of family) {
    for (const w of windows) {
      if (w.dayOfWeek !== f.dayOfWeek) continue;
      const len = w.endMinute - w.startMinute;
      if (len <= 0) continue;
      total += (w.weeklyAvailableHours * overlapMinutes(f, w)) / len;
    }
  }
  return total;
}

function scheduleCoverage(family: MatchRequest["preferredWindows"], windows: MatchCenter["windows"]): number {
  const totalFamily = family.reduce((s, f) => s + (f.endMinute - f.startMinute), 0);
  if (totalFamily === 0) return 0;
  let covered = 0;
  for (const f of family) {
    // union of covering windows on that day (windows can only overlap across modes)
    const segs = windows
      .filter((w) => w.dayOfWeek === f.dayOfWeek && w.weeklyAvailableHours > 0)
      .map((w) => [Math.max(f.startMinute, w.startMinute), Math.min(f.endMinute, w.endMinute)] as const)
      .filter(([s, e]) => e > s)
      .sort((a, b) => a[0] - b[0]);
    let curS = -1;
    let curE = -1;
    for (const [s, e] of segs) {
      if (s > curE) {
        if (curE > curS) covered += curE - curS;
        curS = s;
        curE = e;
      } else curE = Math.max(curE, e);
    }
    if (curE > curS) covered += curE - curS;
  }
  return Math.min(1, covered / totalFamily);
}

const fmt = (n: number) => round(n, 1).toFixed(1);

export function evaluateCenter(req: MatchRequest, center: MatchCenter, ctx: MatchContext): CenterMatch {
  const gates: Gate[] = [];
  const actions: string[] = [];
  const requestedHoursAssumed = req.requestedDirectHoursPerWeek == null;
  const h = req.requestedDirectHoursPerWeek ?? ctx.policy.planningDefaultDirectHours;

  // 1. Geography -------------------------------------------------------------
  let distanceMiles: number | null = null;
  if (!center.active) {
    gates.push({ key: "geography", label: "Site active & in reach", status: "fail", reason: "Site is inactive" });
  } else if (!ctx.zcta || center.latitude == null || center.longitude == null) {
    gates.push({
      key: "geography",
      label: "Site active & in reach",
      status: "verification_needed",
      reason: !ctx.zcta
        ? `ZIP ${req.serviceZip} is not in the configured study area; staff must confirm geographic reach`
        : "Site coordinates not configured; staff must confirm geographic reach",
    });
    actions.push("Confirm the family's location is within a site's service area");
  } else {
    distanceMiles = round(haversineMiles(ctx.zcta, { lat: center.latitude, lng: center.longitude }), 1);
    const inReach = distanceMiles <= center.serviceRadiusMiles;
    gates.push({
      key: "geography",
      label: "Site active & in reach",
      status: inReach ? "pass" : "fail",
      reason: inReach
        ? `~${distanceMiles} mi great-circle from ZCTA centroid, within ${center.serviceRadiusMiles} mi operational radius (approximation; travel time not evaluated)`
        : `~${distanceMiles} mi exceeds ${center.serviceRadiusMiles} mi operational radius`,
    });
  }

  // 2. Payer -------------------------------------------------------------------
  const payerLabel = ctx.payerName ?? "Selected payer";
  if (!req.payerId) {
    gates.push({
      key: "payer",
      label: "Payer participation",
      status: "verification_needed",
      reason: "Payer not recorded — collect payer information (family is not filtered out)",
    });
    actions.push("Record payer information with the family");
  } else {
    const p = center.payers.find((x) => x.payerId === req.payerId);
    const age = ageDays(ctx.now, p?.lastVerifiedAt ?? null);
    if (!p || p.status === "unknown") {
      gates.push({
        key: "payer",
        label: "Payer participation",
        status: "verification_needed",
        reason: `${payerLabel}: site participation status unknown — ops must verify (not a denial)`,
      });
      actions.push(`Verify ${center.name} participation with ${payerLabel}`);
    } else if (p.status === "not_accepted") {
      gates.push({
        key: "payer",
        label: "Payer participation",
        status: "fail",
        reason: `${payerLabel}: staff recorded this site as not accepting this payer`,
      });
    } else if (age === null || age > ctx.policy.payerVerificationMaxAgeDays) {
      gates.push({
        key: "payer",
        label: "Payer participation",
        status: "verification_needed",
        reason: `${payerLabel}: participation last verified ${age === null ? "never" : `${age} days ago`} (policy ${ctx.policy.payerVerificationMaxAgeDays} days) — re-verify`,
      });
      actions.push(`Re-verify ${center.name} participation with ${payerLabel}`);
    } else {
      gates.push({
        key: "payer",
        label: "Payer participation",
        status: "pass",
        reason: `${payerLabel}: staff verified site participation ${age} days ago; individual benefits unverified`,
      });
    }
  }

  // 3. Service mode -------------------------------------------------------------
  const modes = req.preferredModes.filter((m) => center.serviceModes.includes(m));
  gates.push({
    key: "service_mode",
    label: "Service mode",
    status: modes.length ? "pass" : "fail",
    reason: modes.length
      ? `Offers ${modes.join(", ").replaceAll("_if_applicable", "")}`
      : `Site does not offer ${req.preferredModes.join(" or ").replaceAll("_if_applicable", "")}`,
  });

  // 3b. Age policy (only when both provided) -------------------------------------
  if (req.childAgeYears == null || (center.acceptedAgeMin == null && center.acceptedAgeMax == null)) {
    gates.push({
      key: "age_policy",
      label: "Practice age policy",
      status: "not_applicable",
      reason:
        req.childAgeYears == null
          ? "Age not provided; staff confirm against site policy"
          : "Site has no configured age policy",
    });
  } else {
    const okMin = center.acceptedAgeMin == null || req.childAgeYears >= center.acceptedAgeMin;
    const okMax = center.acceptedAgeMax == null || req.childAgeYears <= center.acceptedAgeMax;
    gates.push({
      key: "age_policy",
      label: "Practice age policy",
      status: okMin && okMax ? "pass" : "fail",
      reason: `Site policy ages ${center.acceptedAgeMin ?? "any"}–${center.acceptedAgeMax ?? "any"}`,
    });
  }

  // 4. RBT schedule & capacity ------------------------------------------------------
  const rbt = center.windows.filter((w) => w.role === "RBT" && modes.includes(w.serviceMode));
  const rbtVerified = rbt.filter((w) => isWindowVerified(w, ctx));
  const rbtUnverified = rbt.filter((w) => !isWindowVerified(w, ctx));
  const heldDirect = center.holds.reduce((s, x) => s + x.directWeeklyHours, 0);
  const heldBcba = center.holds.reduce((s, x) => s + x.bcbaWeeklyHours, 0);
  const verifiedRbtTotal = rbtVerified.reduce((s, w) => s + w.weeklyAvailableHours, 0);
  const verifiedOverlap = overlapHours(req.preferredWindows, rbtVerified);
  const unverifiedOverlap = overlapHours(req.preferredWindows, rbtUnverified);
  const feasibleRbt = Math.max(0, Math.min(verifiedOverlap, verifiedRbtTotal - heldDirect));
  const hLabel = `${fmt(h)} requested h/wk${requestedHoursAssumed ? " (planning default)" : ""}`;

  if (modes.length === 0) {
    gates.push({ key: "rbt_schedule", label: "RBT schedule fit", status: "not_applicable", reason: "No compatible service mode" });
  } else if (rbt.length === 0) {
    gates.push({
      key: "rbt_schedule",
      label: "RBT schedule fit",
      status: "verification_needed",
      reason: "No RBT availability recorded for this mode — staff availability unknown",
    });
    actions.push(`Ops: publish ${center.name} RBT availability`);
  } else if (req.preferredWindows.length === 0) {
    gates.push({
      key: "rbt_schedule",
      label: "RBT schedule fit",
      status: "verification_needed",
      reason: "Family time windows not recorded — cannot check schedule compatibility",
    });
    actions.push("Record the family's preferred days/times");
  } else if (feasibleRbt + 1e-9 >= h) {
    gates.push({
      key: "rbt_schedule",
      label: "RBT schedule fit",
      status: "pass",
      reason: `${fmt(feasibleRbt)} verified RBT h/wk overlap family windows after ${fmt(heldDirect)} h holds; ${hLabel}`,
    });
  } else if (feasibleRbt + unverifiedOverlap + 1e-9 >= h) {
    const staleNote = rbtUnverified.some((w) => w.verifiedAt)
      ? `older than ${ctx.policy.capacityVerificationMaxAgeDays}-day policy`
      : "pending ops verification";
    gates.push({
      key: "rbt_schedule",
      label: "RBT schedule fit",
      status: "verification_needed",
      reason: `${fmt(feasibleRbt)} verified + ${fmt(unverifiedOverlap)} unverified RBT h/wk (${staleNote}) overlap family windows; ${hLabel}`,
    });
    actions.push(`Ops: verify ${center.name} RBT availability`);
  } else {
    gates.push({
      key: "rbt_schedule",
      label: "RBT schedule fit",
      status: "fail",
      reason: `Only ${fmt(feasibleRbt)} verified RBT h/wk overlap family windows (after ${fmt(heldDirect)} h holds); ${hLabel}`,
    });
  }

  // 5. BCBA supervision ---------------------------------------------------------------
  const rule =
    (req.payerId ? center.rules.find((r) => r.payerId === req.payerId) : undefined) ??
    center.rules.find((r) => r.payerId === null);
  const bcbaWindows = center.windows.filter((w) => w.role === "BCBA");
  const bcbaVerified = bcbaWindows.filter((w) => isWindowVerified(w, ctx)).reduce((s, w) => s + w.weeklyAvailableHours, 0);
  const bcbaUnverified = bcbaWindows
    .filter((w) => !isWindowVerified(w, ctx))
    .reduce((s, w) => s + w.weeklyAvailableHours, 0);
  const bcbaAvail = Math.max(0, bcbaVerified - heldBcba);
  let bcbaRequired: number | null = null;
  if (!rule || rule.requiredBcbaHoursPerDirectHour == null) {
    gates.push({
      key: "bcba_supervision",
      label: "BCBA supervision",
      status: "verification_needed",
      reason: "No organization-validated supervision rule configured",
    });
    actions.push(`Ops: configure verified supervision rule for ${center.name}`);
  } else if (!rule.isVerified) {
    gates.push({
      key: "bcba_supervision",
      label: "BCBA supervision",
      status: "verification_needed",
      reason: "Supervision rule exists but is not verified by the organization",
    });
    actions.push(`Ops: verify supervision rule for ${center.name}`);
  } else {
    bcbaRequired = h * rule.requiredBcbaHoursPerDirectHour;
    const ratio = rule.requiredBcbaHoursPerDirectHour;
    if (bcbaAvail + 1e-9 >= bcbaRequired) {
      gates.push({
        key: "bcba_supervision",
        label: "BCBA supervision",
        status: "pass",
        reason: `${fmt(bcbaAvail)} verified BCBA h/wk available ≥ ${fmt(bcbaRequired)} required (${ratio} per direct hour)`,
      });
    } else if (bcbaAvail + bcbaUnverified + 1e-9 >= bcbaRequired) {
      gates.push({
        key: "bcba_supervision",
        label: "BCBA supervision",
        status: "verification_needed",
        reason: `${fmt(bcbaAvail)} verified + ${fmt(bcbaUnverified)} unverified BCBA h/wk; ${fmt(bcbaRequired)} required`,
      });
      actions.push(`Ops: verify ${center.name} BCBA availability`);
    } else {
      gates.push({
        key: "bcba_supervision",
        label: "BCBA supervision",
        status: "fail",
        reason: `${fmt(bcbaAvail)} verified BCBA h/wk < ${fmt(bcbaRequired)} required (${ratio} per direct hour)`,
      });
    }
  }

  // 6. Weekly new-start limit --------------------------------------------------------------
  const maxNew = rule?.maxNewStartsPerWeek ?? null;
  const committed = center.startsLast7Days + center.holds.length;
  if (maxNew == null) {
    gates.push({ key: "new_start_limit", label: "Weekly new-start limit", status: "pass", reason: "No weekly limit configured" });
  } else if (committed >= maxNew) {
    gates.push({
      key: "new_start_limit",
      label: "Weekly new-start limit",
      status: "fail",
      reason: `${committed} starts/holds in last 7 days ≥ limit of ${maxNew}`,
    });
  } else {
    gates.push({
      key: "new_start_limit",
      label: "Weekly new-start limit",
      status: "pass",
      reason: `${committed} of ${maxNew} weekly new starts used`,
    });
  }

  const statuses = gates.map((g) => g.status);
  const eligibility: Eligibility = statuses.includes("fail")
    ? "not_feasible"
    : statuses.includes("verification_needed")
      ? "verification_needed"
      : "potential_fit";

  let scoreComponents: ScoreComponents | null = null;
  let score: number | null = null;
  if (eligibility === "potential_fit") {
    scoreComponents = {
      schedule: round(scheduleCoverage(req.preferredWindows, rbtVerified), 3),
      capacity: round(Math.min(1, Math.max(0, verifiedRbtTotal - heldDirect) / (4 * h)), 3),
      distance: round(distanceMiles == null ? 0 : Math.max(0, 1 - distanceMiles / center.serviceRadiusMiles), 3),
      backlog: round(1 / (1 + center.onboardingBacklog / 10), 3),
    };
    score = round(
      100 *
        (SCORE_WEIGHTS.schedule * scoreComponents.schedule +
          SCORE_WEIGHTS.capacity * scoreComponents.capacity +
          SCORE_WEIGHTS.distance * scoreComponents.distance +
          SCORE_WEIGHTS.backlog * scoreComponents.backlog),
      1,
    );
  }

  const verifiedDates = center.windows.filter((w) => isWindowVerified(w, ctx)).map((w) => w.verifiedAt!.getTime());
  return {
    centerId: center.id,
    centerName: center.name,
    eligibility,
    score,
    distanceMiles,
    capacityEvidenceAt: verifiedDates.length ? new Date(Math.max(...verifiedDates)).toISOString() : null,
    gates,
    scoreComponents,
    capacity: {
      requestedHours: h,
      requestedHoursAssumed,
      verifiedRbtOverlapHours: round(verifiedOverlap, 2),
      unverifiedRbtOverlapHours: round(unverifiedOverlap, 2),
      verifiedRbtTotalHours: round(verifiedRbtTotal, 2),
      heldDirectHours: round(heldDirect, 2),
      bcbaRequiredHours: bcbaRequired === null ? null : round(bcbaRequired, 2),
      bcbaAvailableHours: round(bcbaAvail, 2),
    },
    staffActions: actions,
  };
}

const ELIGIBILITY_ORDER: Record<Eligibility, number> = { potential_fit: 0, verification_needed: 1, not_feasible: 2 };

export function evaluateMatch(req: MatchRequest, centers: MatchCenter[], ctx: MatchContext): MatchResult {
  const matches = centers
    .map((c) => evaluateCenter(req, c, ctx))
    .sort(
      (a, b) =>
        ELIGIBILITY_ORDER[a.eligibility] - ELIGIBILITY_ORDER[b.eligibility] ||
        (b.score ?? -1) - (a.score ?? -1) ||
        // fairness-preserving deterministic tie-break by center ID
        a.centerId.localeCompare(b.centerId),
    );
  const status = matches.some((m) => m.eligibility === "potential_fit")
    ? "potential_fit"
    : matches.some((m) => m.eligibility === "verification_needed")
      ? "verification_needed"
      : "no_feasible_match";

  const required = new Set<string>();
  if (status === "potential_fit") {
    required.add("Verify individual benefits and required authorization (not determined by CareFlow)");
    required.add("Confirm clinician scheduling with the site — no appointment is reserved");
  }
  for (const m of matches) if (m.eligibility !== "not_feasible") m.staffActions.forEach((a) => required.add(a));
  if (status === "no_feasible_match") {
    required.add("Offer a human-reviewed alternate path: waitlist, referral resources, or re-check after capacity changes");
  }
  return {
    status,
    matches,
    requiredStaffActions: [...required],
    evaluatedAt: ctx.now.toISOString(),
    disclaimer: MATCH_DISCLAIMER,
  };
}

/** Verified weekly direct hours available for NEW starts at a center (PRD §7 KPI). */
export function verifiedDirectHoursAvailable(
  center: MatchCenter,
  ctx: { now: Date; policy: TenantPolicy },
): { hours: number | null; pendingHours: number; reason: string } {
  const c = { ...ctx, zcta: null } as MatchContext;
  const rbt = center.windows.filter((w) => w.role === "RBT");
  const verified = rbt.filter((w) => isWindowVerified(w, c)).reduce((s, w) => s + w.weeklyAvailableHours, 0);
  const pending = rbt.filter((w) => !isWindowVerified(w, c)).reduce((s, w) => s + w.weeklyAvailableHours, 0);
  const held = center.holds.reduce((s, x) => s + x.directWeeklyHours, 0);
  const heldBcba = center.holds.reduce((s, x) => s + x.bcbaWeeklyHours, 0);
  const rule = center.rules.find((r) => r.payerId === null);
  if (!rule || !rule.isVerified || rule.requiredBcbaHoursPerDirectHour == null) {
    return { hours: null, pendingHours: round(pending + verified, 1), reason: "Supervision rule unverified — hours not counted" };
  }
  const bcba = center.windows
    .filter((w) => w.role === "BCBA" && isWindowVerified(w, c))
    .reduce((s, w) => s + w.weeklyAvailableHours, 0);
  const rbtFree = Math.max(0, verified - held);
  const bcbaCap =
    rule.requiredBcbaHoursPerDirectHour > 0 ? Math.max(0, bcba - heldBcba) / rule.requiredBcbaHoursPerDirectHour : Infinity;
  if (rule.maxNewStartsPerWeek != null && center.startsLast7Days + center.holds.length >= rule.maxNewStartsPerWeek) {
    return { hours: 0, pendingHours: round(pending, 1), reason: "Weekly new-start limit reached" };
  }
  const hours = Math.floor(Math.min(rbtFree, bcbaCap));
  const reason = bcbaCap < rbtFree ? "Limited by verified BCBA supervision" : "Limited by verified RBT availability";
  return { hours, pendingHours: round(pending, 1), reason };
}
