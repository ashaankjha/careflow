import { createDb } from "../src/client";
import { seedDatabase } from "../src/seed";
import { HARBOR, LAKESIDE, userId } from "../src/seed/fixtures";
import type { Ctx } from "../src/services/context";

/** Fixed anchor so integration tests are fully deterministic. */
export const ANCHOR = new Date("2026-10-01T18:00:00Z");

export function testDb() {
  return createDb(process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/careflow_test", { max: 4 });
}

/** Least-privilege `careflow_app` connection to the test database (RLS applies). */
export function testAppDb(max = 4) {
  return createDb(process.env.TEST_APP_DATABASE_URL ?? "postgres://careflow_app:careflow_app_dev_only@localhost:5432/careflow_test", { max });
}

export async function reseed(db: ReturnType<typeof testDb>["db"]) {
  return seedDatabase(db, { now: ANCHOR });
}

export const harbor = (role: Ctx["role"] = "admin", key: string = role): Ctx => ({ orgId: HARBOR.id, userId: userId(key === "admin" || key === "growth" || key === "ops" || key === "intake" || key === "viewer" ? key : "admin"), role, now: ANCHOR });
export const lakeside = (): Ctx => ({ orgId: LAKESIDE.id, userId: userId("lakeside_admin"), role: "admin", now: ANCHOR });

/** Resolve the underlying Postgres error message (drizzle wraps it in `cause`). */
export async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as { message?: string; cause?: { message?: string } };
    return `${err.message ?? ""} ${err.cause?.message ?? ""}`;
  }
  throw new Error("expected the query to fail");
}
