import { can, type Action, type Role } from "@careflow/core";

/** Authenticated, tenant-scoped request context. Every service call requires one. */
export type Ctx = {
  orgId: string;
  userId: string | null;
  role: Role;
  requestId?: string;
  now?: Date;
};

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "INVALID_TRANSITION"
  | "CONFLICT"
  | "FEATURE_DISABLED"
  | "DEMO_ONLY"
  | "RATE_LIMITED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  INVALID_TRANSITION: 409,
  CONFLICT: 409,
  FEATURE_DISABLED: 403,
  DEMO_ONLY: 403,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export function assertCan(ctx: Ctx, action: Action): void {
  if (!can(ctx.role, action)) throw new AppError("FORBIDDEN", `Role '${ctx.role}' may not perform ${action}`);
}

export const nowOf = (ctx: Ctx) => ctx.now ?? new Date();
