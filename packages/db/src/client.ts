import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;

export function createDb(url: string, opts: { max?: number } = {}) {
  const client = postgres(url, { max: opts.max ?? 10, onnotice: () => {}, prepare: true });
  const db = drizzle(client, { schema });
  // drizzle installs pass-through timestamp serializers (it maps columns itself); raw `sql` templates
  // may still pass Date objects, so serialize those to ISO-8601 here.
  const serializeDate = (v: unknown) => (v instanceof Date ? v.toISOString() : v);
  for (const oid of ["1082", "1083", "1114", "1184", "1182", "1185", "1115", "1231"]) {
    (client.options.serializers as Record<string, (v: unknown) => unknown>)[oid] = serializeDate;
  }
  return { db, client };
}

const globalForDb = globalThis as unknown as { __careflowDb?: ReturnType<typeof createDb>; __careflowAppDb?: ReturnType<typeof createDb> };

/**
 * Owner / migration URL (superuser or BYPASSRLS + table owner). Used by
 * migrations, `db:seed`, `db:reset`, the jobs CLI and the demo-reset purge path.
 */
export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/careflow";
}

/**
 * Least-privilege application URL: role `careflow_app` (no ownership, no
 * BYPASSRLS). The web app uses only this for request traffic, so the FORCEd
 * RLS policies always apply. The default password is a dev-only value.
 */
export function appDatabaseUrl(): string {
  return process.env.APP_DATABASE_URL ?? "postgres://careflow_app:careflow_app_dev_only@localhost:5432/careflow";
}

/** Process-wide pooled OWNER client (survives Next.js dev HMR). Not for request traffic. */
export function getDb(): Db {
  if (!globalForDb.__careflowDb) globalForDb.__careflowDb = createDb(databaseUrl());
  return globalForDb.__careflowDb.db;
}

/** Process-wide pooled APP-ROLE client. Queries only see rows once `withOrg` sets the tenant. */
export function getAppDb(): Db {
  if (!globalForDb.__careflowAppDb) globalForDb.__careflowAppDb = createDb(appDatabaseUrl());
  return globalForDb.__careflowAppDb.db;
}

export async function pingDb(db: Db = getAppDb()): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
