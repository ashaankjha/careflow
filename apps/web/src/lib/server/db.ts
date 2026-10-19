import "server-only";
import { getAppDb, getDb, withOrg as withOrgTx, type Ctx, type Db } from "@careflow/db";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Tenant-scoped executor for the current request. Every API route (via
 * `route()`) and every server-component data load (via `withOrg`) runs inside
 * one app-role transaction with `app.current_org` set; `db()` returns that
 * transaction. Calling it outside such a scope throws instead of silently
 * querying without a tenant.
 *
 * The transaction is typed as `Db` because several services declare `Db`; a
 * drizzle transaction supports the same query surface (nested `transaction()`
 * calls become savepoints).
 */
const scope = new AsyncLocalStorage<Db>();

export function db(): Db {
  const tx = scope.getStore();
  if (!tx) throw new Error("db() called outside a tenant scope — wrap the data load in withOrg() or route()");
  return tx;
}

/** Run `fn` in one app-role transaction scoped to the session's organization. */
export function withOrg<T>(ctx: Pick<Ctx, "orgId">, fn: (db: Db) => Promise<T>): Promise<T> {
  return withOrgTx(getAppDb(), ctx.orgId, (tx) => {
    const scoped = tx as unknown as Db;
    return scope.run(scoped, () => fn(scoped));
  });
}

/** Unscoped app-role pool: only for pre-tenant work (session lookup, sign-in, rate limiting). RLS hides all tenant rows here. */
export const publicDb = () => getAppDb();

/**
 * Owner connection for the demo-reset purge path only (see `resetDemo`).
 * Disabled with DEMO_RESET_ENABLED=false — required for any non-demo deployment,
 * which should then not receive DATABASE_URL at all.
 */
export function maintenanceDb(): Db | null {
  return process.env.DEMO_RESET_ENABLED === "false" ? null : getDb();
}
