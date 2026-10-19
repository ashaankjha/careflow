import { and, desc, eq } from "drizzle-orm";
import type { Executor } from "../client";
import { auditLogs } from "../schema";
import type { Ctx } from "./context";

/**
 * Append-only audit trail. `details` must contain only non-sensitive
 * identifiers/counts — never request bodies, aliases or notes.
 */
export async function audit(
  db: Executor,
  ctx: Ctx,
  action: string,
  entityType: string,
  entityId: string | null,
  allowed = true,
  details: Record<string, unknown> = {},
) {
  await db.insert(auditLogs).values({
    organizationId: ctx.orgId,
    actorId: ctx.userId,
    actorRole: ctx.role,
    action,
    entityType,
    entityId,
    allowed,
    details,
    requestId: ctx.requestId ?? null,
  });
}

export async function listAudit(db: Executor, ctx: Ctx, limit = 100) {
  return db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.organizationId, ctx.orgId)))
    .orderBy(desc(auditLogs.eventTime))
    .limit(Math.min(limit, 500));
}
