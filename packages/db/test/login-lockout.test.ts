import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HARBOR } from "../src/index";
import { AppError } from "../src/services/context";
import { DEFAULT_LOGIN_LOCKOUT, loginAccountKey, loginLockoutConfig } from "../src/services/rate-limit";
import { login, LOGIN_RATE_LIMITED_MESSAGE } from "../src/services/session";
import { pgError, reseed, testAppDb, testDb } from "./helpers";

const owner = testDb();
const app = testAppDb();
beforeAll(() => reseed(owner.db));
afterAll(async () => {
  // Leave no locks behind for other test files that sign in as the same accounts.
  await owner.db.execute(sql`delete from login_attempts`);
  await Promise.all([owner.client.end(), app.client.end()]);
});
beforeEach(async () => {
  await owner.db.execute(sql`delete from login_attempts`);
});

const PASSWORD = "demo-pass-2026";
const cfg = { maxFailures: 3, windowSeconds: 900, lockSeconds: 900 };

/** The rejection a caller sees: "ok", "invalid" (null) or the AppError code + message. */
async function attempt(email: string, password: string, lockout = cfg) {
  try {
    return (await login(app.db, email, password, { lockout })) ? "ok" : "invalid";
  } catch (e) {
    if (e instanceof AppError) return `${e.code}: ${e.message}`;
    throw e;
  }
}
const LOCKED = `RATE_LIMITED: ${LOGIN_RATE_LIMITED_MESSAGE}`;

describe("per-account sign-in lockout", () => {
  it("defaults to 5 failures in 15 min → 15 min lock, overridable via env", () => {
    expect(loginLockoutConfig({})).toEqual(DEFAULT_LOGIN_LOCKOUT);
    expect(DEFAULT_LOGIN_LOCKOUT).toEqual({ maxFailures: 5, windowSeconds: 900, lockSeconds: 900 });
    expect(loginLockoutConfig({ LOGIN_LOCKOUT_MAX_FAILURES: "8", LOGIN_LOCKOUT_WINDOW_SECONDS: "60", LOGIN_LOCKOUT_SECONDS: "abc" })).toEqual({ maxFailures: 8, windowSeconds: 60, lockSeconds: 900 });
  });

  it("locks the account after N consecutive failures, then rejects even the correct password", async () => {
    expect([await attempt("growth@harbor.demo", "x"), await attempt("growth@harbor.demo", "x"), await attempt("growth@harbor.demo", "x")]).toEqual(["invalid", "invalid", "invalid"]);
    expect(await attempt("growth@harbor.demo", PASSWORD)).toBe(LOCKED);
    // Email normalization: case/whitespace variants share the lock.
    expect(await attempt("  GROWTH@harbor.demo ", PASSWORD)).toBe(LOCKED);
    // Other accounts are unaffected.
    expect(await attempt("ops@harbor.demo", PASSWORD)).toBe("ok");
  });

  it("a successful sign-in resets the streak", async () => {
    await attempt("ops@harbor.demo", "x");
    await attempt("ops@harbor.demo", "x");
    expect(await attempt("ops@harbor.demo", PASSWORD)).toBe("ok");
    await attempt("ops@harbor.demo", "x");
    await attempt("ops@harbor.demo", "x");
    expect(await attempt("ops@harbor.demo", PASSWORD)).toBe("ok");
  });

  it("unknown emails lock exactly like real accounts (no existence oracle)", async () => {
    const seq = async (email: string) => {
      const out = [];
      for (let i = 0; i < 4; i++) out.push(await attempt(email, "x"));
      return out;
    };
    const known = await seq("viewer@harbor.demo");
    const unknown = await seq("nobody@harbor.demo");
    expect(known).toEqual(["invalid", "invalid", "invalid", LOCKED]);
    expect(unknown).toEqual(known);
    // Only hashes are stored.
    const rows = (await owner.db.execute(sql`select account_key from login_attempts order by 1`)) as unknown as { account_key: string }[];
    expect(rows.map((r) => r.account_key).sort()).toEqual([loginAccountKey("nobody@harbor.demo"), loginAccountKey("viewer@harbor.demo")].sort());
    for (const r of rows) expect(r.account_key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the streak restarts after the window and the lock expires after the cool-down", async () => {
    const key = loginAccountKey("intake@harbor.demo");
    await attempt("intake@harbor.demo", "x");
    await attempt("intake@harbor.demo", "x");
    await owner.db.execute(sql`update login_attempts set first_failure_at = now() - interval '901 seconds' where account_key = ${key}`);
    expect(await attempt("intake@harbor.demo", "x")).toBe("invalid");
    expect(await attempt("intake@harbor.demo", "x")).toBe("invalid"); // 2 in the new window: still open
    expect(await attempt("intake@harbor.demo", "x")).toBe("invalid"); // 3rd → locks
    expect(await attempt("intake@harbor.demo", PASSWORD)).toBe(LOCKED);
    await owner.db.execute(sql`update login_attempts set locked_until = now() - interval '1 second' where account_key = ${key}`);
    expect(await attempt("intake@harbor.demo", PASSWORD)).toBe("ok");
  });

  it("audits the lock once in the account's organization, without the email", async () => {
    const before = (await owner.db.execute(sql`select count(*)::int n from audit_logs where action = 'auth.lockout'`)) as unknown as { n: number }[];
    for (let i = 0; i < 5; i++) await attempt("admin@lakeside.demo", "x");
    const rows = (await owner.db.execute(
      sql`select organization_id, actor_id, allowed, entity_type, details from audit_logs where action = 'auth.lockout' order by event_time desc`,
    )) as unknown as Record<string, unknown>[];
    expect(rows.length - before[0]!.n).toBe(1);
    expect(rows[0]).toMatchObject({ actor_id: null, allowed: false, entity_type: "user", details: { failures: 3, lockSeconds: 900 } });
    expect(rows[0]!.organization_id).not.toBe(HARBOR.id);
    expect(JSON.stringify(rows[0])).not.toContain("lakeside.demo");
  });

  it("the app role cannot read or reset the table directly, only via the SECURITY DEFINER functions", async () => {
    expect(await pgError(app.db.execute(sql`select * from login_attempts`))).toMatch(/permission denied/);
    expect(await pgError(app.db.execute(sql`delete from login_attempts`))).toMatch(/permission denied/);
    expect(await pgError(app.db.execute(sql`select * from careflow_login_failure('short', 5, 900, 900)`))).toMatch(/invalid account key/);
  });

  it("clamps caller-supplied limits in the database", async () => {
    const key = loginAccountKey("clamp@harbor.demo");
    const rows = (await app.db.execute(sql`select * from careflow_login_failure(${key}, 0, 900, 999999999)`)) as unknown as { newly_locked: boolean; locked_until: string }[];
    expect(rows[0]!.newly_locked).toBe(true);
    const secs = (new Date(rows[0]!.locked_until).getTime() - Date.now()) / 1000;
    expect(secs).toBeLessThanOrEqual(86_400 + 5);
  });
});
