import { eq } from "drizzle-orm";
import type { Db, Executor } from "../client";
import { organizations, users } from "../schema";
import { seedDatabase, DEMO_ORG_IDS } from "../seed";
import { assertMaintenanceRole } from "../scripts/migrate";
import { audit } from "./audit";
import { AppError, assertCan, type Ctx } from "./context";

/**
 * POST /demo/reset — admin only, demo organisations only. Restores the exact seed state.
 *
 * `db` is the caller's tenant-scoped (app-role) executor: it performs the
 * checks and writes the audit row. The purge + reseed spans both demo tenants
 * and immutable tables, so it runs on the separate `maintenance` connection
 * (owner role with SUPERUSER/BYPASSRLS — DATABASE_URL). Pass `null` where no
 * maintenance connection is configured; reset is then FEATURE_DISABLED.
 */
export async function resetDemo(db: Executor, ctx: Ctx, maintenance: Db | null = null) {
  assertCan(ctx, "demo:reset");
  const [org] = await db.select().from(organizations).where(eq(organizations.id, ctx.orgId));
  if (!org?.demoMode || !DEMO_ORG_IDS.includes(ctx.orgId)) {
    await audit(db, ctx, "demo.reset", "organization", ctx.orgId, false, { reason: "not_demo" });
    throw new AppError("DEMO_ONLY", "Reset is only available for demo organizations");
  }
  if (!maintenance) {
    await audit(db, ctx, "demo.reset", "organization", ctx.orgId, false, { reason: "maintenance_connection_disabled" });
    throw new AppError("FEATURE_DISABLED", "Demo reset is disabled in this deployment");
  }
  await assertMaintenanceRole(maintenance);
  const result = await seedDatabase(maintenance);
  await audit(db, ctx, "demo.reset", "organization", ctx.orgId, true, result);
  return result;
}

export async function listUsers(db: Executor, ctx: Ctx) {
  assertCan(ctx, "settings:read");
  return db
    .select({ id: users.id, email: users.email, displayName: users.displayName, role: users.role })
    .from(users)
    .where(eq(users.organizationId, ctx.orgId))
    .orderBy(users.role);
}
