import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
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

/**
 * Per-account sign-in lockout (migration 0004). After `maxFailures` consecutive
 * failed sign-ins for one normalized email within `windowSeconds`, every further
 * attempt for that email is rejected for `lockSeconds`, whatever the source IP.
 * A successful sign-in clears the streak. Defaults: 5 failures / 15 min →
 * 15 min lock. Deployment-wide (sign-in runs before the tenant is known), set via
 * LOGIN_LOCKOUT_MAX_FAILURES, LOGIN_LOCKOUT_WINDOW_SECONDS, LOGIN_LOCKOUT_SECONDS;
 * the database clamps each to a sane range.
 */
export type LoginLockoutConfig = { maxFailures: number; windowSeconds: number; lockSeconds: number };

export const DEFAULT_LOGIN_LOCKOUT: LoginLockoutConfig = { maxFailures: 5, windowSeconds: 900, lockSeconds: 900 };

export function loginLockoutConfig(env: Record<string, string | undefined> = process.env): LoginLockoutConfig {
  const int = (v: string | undefined, d: number) => {
    const n = Number.parseInt(v ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    maxFailures: int(env.LOGIN_LOCKOUT_MAX_FAILURES, DEFAULT_LOGIN_LOCKOUT.maxFailures),
    windowSeconds: int(env.LOGIN_LOCKOUT_WINDOW_SECONDS, DEFAULT_LOGIN_LOCKOUT.windowSeconds),
    lockSeconds: int(env.LOGIN_LOCKOUT_SECONDS, DEFAULT_LOGIN_LOCKOUT.lockSeconds),
  };
}

/**
 * Lockout key: SHA-256 of the normalized email. Computed the same way whether or
 * not the account exists, so unknown emails lock exactly like real ones and the
 * table never stores an address.
 */
export function loginAccountKey(email: string): string {
  return createHash("sha256").update(`careflow-login:${email.trim().toLowerCase()}`).digest("hex");
}

export async function loginLockedUntil(db: Executor, accountKey: string): Promise<Date | null> {
  const rows = (await db.execute(sql`select careflow_login_locked_until(${accountKey}) as until`)) as unknown as { until: string | Date | null }[];
  const until = rows[0]?.until;
  return until ? new Date(until) : null;
}

export async function recordLoginFailure(db: Executor, accountKey: string, cfg: LoginLockoutConfig): Promise<{ failures: number; lockedUntil: Date | null; newlyLocked: boolean }> {
  const rows = (await db.execute(
    sql`select * from careflow_login_failure(${accountKey}, ${cfg.maxFailures}, ${cfg.windowSeconds}, ${cfg.lockSeconds})`,
  )) as unknown as { failures: number; locked_until: string | Date | null; newly_locked: boolean }[];
  const r = rows[0];
  return { failures: Number(r?.failures ?? 0), lockedUntil: r?.locked_until ? new Date(r.locked_until) : null, newlyLocked: Boolean(r?.newly_locked) };
}

export async function clearLoginFailures(db: Executor, accountKey: string): Promise<void> {
  await db.execute(sql`select careflow_login_success(${accountKey})`);
}
