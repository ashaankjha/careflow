import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { organizations, users } from "../schema";
import { seedDatabase, DEMO_ORG_IDS } from "../seed";
import { audit } from "./audit";
import { AppError, assertCan, type Ctx } from "./context";

/** POST /demo/reset — admin only, demo organisations only. Restores the exact seed state. */
export async function resetDemo(db: Db, ctx: Ctx) {
  assertCan(ctx, "demo:reset");
  const [org] = await db.select().from(organizations).where(eq(organizations.id, ctx.orgId));
  if (!org?.demoMode || !DEMO_ORG_IDS.includes(ctx.orgId)) {
    await audit(db, ctx, "demo.reset", "organization", ctx.orgId, false, { reason: "not_demo" });
    throw new AppError("DEMO_ONLY", "Reset is only available for demo organizations");
  }
  const result = await seedDatabase(db);
  await audit(db, ctx, "demo.reset", "organization", ctx.orgId, true, result);
  return result;
}

export async function listUsers(db: Db, ctx: Ctx) {
  assertCan(ctx, "settings:read");
  return db
    .select({ id: users.id, email: users.email, displayName: users.displayName, role: users.role })
    .from(users)
    .where(eq(users.organizationId, ctx.orgId))
    .orderBy(users.role);
}
