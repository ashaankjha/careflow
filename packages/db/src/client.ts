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

const globalForDb = globalThis as unknown as { __careflowDb?: ReturnType<typeof createDb> };

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/careflow";
}

/** Process-wide pooled client (survives Next.js dev HMR). */
export function getDb(): Db {
  if (!globalForDb.__careflowDb) globalForDb.__careflowDb = createDb(databaseUrl());
  return globalForDb.__careflowDb.db;
}
