/**
 * Explicit RBAC matrix. Enforced server-side on every route handler; the UI
 * only mirrors it for affordances (never for authorization).
 */
export const ROLES = ["admin", "growth", "intake", "ops", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  "dashboard:read",
  "inquiry:read",
  "inquiry:create",
  "inquiry:transition",
  "inquiry:import",
  "inquiry:export_aggregate",
  "matching:evaluate",
  "matching:persist",
  "capacity:read",
  "capacity:edit",
  "payer:edit",
  "market:read",
  "market:refresh",
  "mission:read",
  "mission:generate",
  "mission:approve",
  "mission:approve_ops_gated",
  "mission:status",
  "draft:generate",
  "draft:edit",
  "draft:approve",
  "draft:export",
  "experiment:read",
  "experiment:manage",
  "partner:read",
  "partner:manage",
  "settings:read",
  "audit:read",
  "sources:read",
  "demo:reset",
] as const;
export type Action = (typeof ACTIONS)[number];

const READ: Action[] = [
  "dashboard:read",
  "inquiry:read",
  "capacity:read",
  "market:read",
  "mission:read",
  "experiment:read",
  "partner:read",
  "settings:read",
  "sources:read",
  "matching:evaluate",
];

const MATRIX: Record<Role, ReadonlySet<Action>> = {
  admin: new Set(ACTIONS),
  growth: new Set<Action>([
    ...READ,
    "inquiry:export_aggregate",
    "mission:generate",
    "mission:approve",
    "mission:status",
    "draft:generate",
    "draft:edit",
    "draft:approve",
    "draft:export",
    "experiment:manage",
    "partner:manage",
  ]),
  intake: new Set<Action>([
    ...READ,
    "inquiry:create",
    "inquiry:transition",
    "inquiry:import",
    "inquiry:export_aggregate",
    "matching:persist",
  ]),
  ops: new Set<Action>([
    ...READ,
    "capacity:edit",
    "payer:edit",
    "mission:generate",
    "mission:approve",
    "mission:approve_ops_gated",
    "mission:status",
    "draft:approve",
    "audit:read",
  ]),
  viewer: new Set<Action>(READ),
};

export function can(role: Role, action: Action): boolean {
  return MATRIX[role]?.has(action) ?? false;
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "System administrator",
  growth: "Growth director",
  intake: "Intake manager",
  ops: "Operations director",
  viewer: "Location manager (read-only)",
};
