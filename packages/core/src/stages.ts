/**
 * Administrative intake stages and the allowed transition graph (PRD §7).
 * Stages are administrative only — they never encode clinical judgement.
 */
export const ACTIVE_STAGES = [
  "new",
  "contacted",
  "qualified",
  "benefits_pending",
  "benefits_verified",
  "assessment_pending",
  "authorization_pending",
  "ready_to_start",
] as const;

export const TERMINAL_EXIT_STAGES = ["closed_unserviceable", "withdrawn", "inactive"] as const;

export const ALL_STAGES = [...ACTIVE_STAGES, "started", "waitlisted", ...TERMINAL_EXIT_STAGES] as const;

export type ActiveStage = (typeof ACTIVE_STAGES)[number];
export type Stage = (typeof ALL_STAGES)[number];

/** Ordered pipeline used for funnel visualisation. */
export const FUNNEL_STAGES: Stage[] = [...ACTIVE_STAGES, "started"];

export const STAGE_LABELS: Record<Stage, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  benefits_pending: "Benefits pending",
  benefits_verified: "Benefits verified",
  assessment_pending: "Assessment pending",
  authorization_pending: "Authorization pending",
  ready_to_start: "Ready to start",
  started: "Started (verified)",
  waitlisted: "Waitlisted",
  closed_unserviceable: "Closed – unserviceable",
  withdrawn: "Withdrawn",
  inactive: "Inactive",
};

export const EVENT_TYPES = [
  "inquiry_created",
  "outreach_attempted",
  "contact_established",
  "payer_info_recorded",
  "benefits_verification_requested",
  "benefits_verified_by_staff",
  "capacity_reviewed",
  "center_match_selected",
  "assessment_scheduled_by_staff",
  "authorization_received_by_staff",
  "care_started_verified_by_staff",
  "inquiry_stage_changed",
  "inquiry_closed",
  "inquiry_reopened",
  "mission_approved",
  "experiment_started",
  "experiment_completed",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_SCHEMA_VERSION = 1;

export function isActiveStage(s: Stage): s is ActiveStage {
  return (ACTIVE_STAGES as readonly string[]).includes(s);
}

export function isExitStage(s: Stage): boolean {
  return (TERMINAL_EXIT_STAGES as readonly string[]).includes(s);
}

/** Stages from which a reason is mandatory when transitioning. */
export function requiresReason(from: Stage, to: Stage): boolean {
  return isExitStage(to) || to === "waitlisted" || isExitStage(from);
}

/**
 * Returns the list of stages reachable from `from`.
 * - Active stages advance exactly one step (no silent skipping of verification steps).
 * - Any non-started stage may move to waitlisted / closed_unserviceable / withdrawn / inactive.
 * - Waitlisted can return to any active stage.
 * - Closed/withdrawn/inactive may be reopened to `contacted` (inquiry_reopened).
 * - `started` is terminal.
 */
export function allowedTransitions(from: Stage): Stage[] {
  if (from === "started") return [];
  const out: Stage[] = [];
  if (isActiveStage(from)) {
    const idx = ACTIVE_STAGES.indexOf(from);
    const next = idx === ACTIVE_STAGES.length - 1 ? "started" : ACTIVE_STAGES[idx + 1]!;
    out.push(next);
    out.push("waitlisted", ...TERMINAL_EXIT_STAGES);
    return out;
  }
  if (from === "waitlisted") {
    return [...ACTIVE_STAGES, ...TERMINAL_EXIT_STAGES];
  }
  // exit stages
  return ["contacted"];
}

export class TransitionError extends Error {
  readonly code = "INVALID_TRANSITION" as const;
  constructor(
    readonly from: Stage,
    readonly to: Stage,
    message?: string,
  ) {
    super(message ?? `Transition ${from} → ${to} is not allowed`);
  }
}

export function assertTransition(from: Stage, to: Stage, reason?: string | null): void {
  if (!allowedTransitions(from).includes(to)) throw new TransitionError(from, to);
  if (requiresReason(from, to) && !reason?.trim()) {
    throw new TransitionError(from, to, `A reason is required to move ${from} → ${to}`);
  }
}

/** Domain event emitted when an inquiry enters a stage. */
export function eventTypeForTransition(from: Stage, to: Stage): EventType {
  if (isExitStage(from)) return "inquiry_reopened";
  switch (to) {
    case "contacted":
      return "contact_established";
    case "qualified":
      return "capacity_reviewed";
    case "benefits_pending":
      return "benefits_verification_requested";
    case "benefits_verified":
      return "benefits_verified_by_staff";
    case "assessment_pending":
      return "assessment_scheduled_by_staff";
    case "ready_to_start":
      return "authorization_received_by_staff";
    case "started":
      return "care_started_verified_by_staff";
    case "closed_unserviceable":
    case "withdrawn":
    case "inactive":
      return "inquiry_closed";
    default:
      return "inquiry_stage_changed";
  }
}
