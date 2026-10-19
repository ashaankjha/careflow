import { sql } from "drizzle-orm";
import type { Db, Tx } from "./client";
import { AppError } from "./services/context";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Set the RLS tenant for the current transaction only (`is_local = true`). */
export async function setTenant(tx: Tx, orgId: string): Promise<void> {
  if (!UUID_RE.test(orgId)) throw new AppError("FORBIDDEN", "Invalid tenant");
  await tx.execute(sql`select set_config('app.current_org', ${orgId}, true)`);
}

/**
 * Run `fn` inside one transaction scoped to `orgId` (RLS `app.current_org`).
 * The setting is transaction-local, so a pooled connection never carries a
 * tenant into the next request.
 *
 * An `AppError` thrown by `fn` still COMMITS what was written before it (e.g.
 * the audit row for a denied send attempt), matching the pre-RLS behaviour of
 * per-statement autocommit; any other error rolls everything back. If a
 * database error already aborted the transaction, Postgres turns the COMMIT
 * into a ROLLBACK.
 */
export async function withOrg<T>(db: Db, orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let appError: AppError | undefined;
  const out = await db.transaction(async (tx) => {
    await setTenant(tx, orgId);
    try {
      return await fn(tx);
    } catch (e) {
      if (e instanceof AppError) {
        appError = e;
        return undefined;
      }
      throw e;
    }
  });
  if (appError) throw appError;
  return out as T;
}
