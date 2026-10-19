import { sql } from "drizzle-orm";
import type { Executor } from "../client";

/**
 * Shared fixed-window rate limiter backed by the UNLOGGED `rate_limit_buckets`
 * table: one atomic upsert per request, so every app process/node sees the same
 * counters. Window boundaries come from the database clock. Returns whether the
 * request is allowed plus the hit count in the current window.
 */
export async function hitRateLimit(db: Executor, key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; hits: number }> {
  const w = Math.max(1, Math.floor(windowSeconds));
  const rows = (await db.execute(sql`
    insert into rate_limit_buckets as b (key, window_start, hits)
    values (${key}, to_timestamp(floor(extract(epoch from now()) / ${w}) * ${w}), 1)
    on conflict (key) do update set
      hits = case when b.window_start = excluded.window_start then b.hits + 1 else 1 end,
      window_start = excluded.window_start
    returning hits`)) as unknown as { hits: number }[];
  const hits = Number(rows[0]?.hits ?? 0);
  // Opportunistic cleanup of stale windows (~1% of calls); keeps the table small without a cron.
  if (Math.random() < 0.01) await db.execute(sql`delete from rate_limit_buckets where window_start < now() - interval '1 hour'`);
  return { allowed: hits <= limit, hits };
}
