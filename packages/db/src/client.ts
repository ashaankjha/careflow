import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;

export function createDb(url: string, opts: { max?: number } = {}) {
  const client = postgres(url, { max: opts.max ?? 10, onnotice: () => {}, prepare: true });
  return { db: drizzle(client, { schema }), client };
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
