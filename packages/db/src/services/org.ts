import { resolvePolicy, type TenantPolicy } from "@careflow/core";
import { eq } from "drizzle-orm";
import type { Executor } from "../client";
import { organizations } from "../schema";
import { AppError, type Ctx } from "./context";

export async function getOrg(db: Executor, ctx: Ctx) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, ctx.orgId));
  if (!org) throw new AppError("NOT_FOUND", "Organization not found");
  return org;
}

export async function getPolicy(db: Executor, ctx: Ctx): Promise<TenantPolicy> {
  const org = await getOrg(db, ctx);
  return resolvePolicy(org.settings);
}
