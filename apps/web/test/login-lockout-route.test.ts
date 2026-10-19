import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Point the app's pooled clients at the dedicated test database before importing server code.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/careflow_test";
process.env.APP_DATABASE_URL = process.env.TEST_APP_DATABASE_URL ?? "postgres://careflow_app:careflow_app_dev_only@localhost:5432/careflow_test";
delete process.env.LOGIN_LOCKOUT_MAX_FAILURES;
delete process.env.LOGIN_LOCKOUT_WINDOW_SECONDS;
delete process.env.LOGIN_LOCKOUT_SECONDS;

const { createDb, seedDatabase } = await import("@careflow/db");
const { POST } = await import("@/app/api/v1/auth/login/route");

const { db: seedDb, client } = createDb(process.env.DATABASE_URL!, { max: 2 });
beforeAll(async () => {
  await seedDatabase(seedDb);
});
afterAll(async () => {
  // Leave no locks behind for other test files that sign in as the same accounts.
  await client`delete from login_attempts`;
  await client`delete from rate_limit_buckets`;
  await client.end();
});
beforeEach(async () => {
  await client`delete from login_attempts`;
  await client`delete from rate_limit_buckets`;
});

let ipCounter = 0;
/** Every attempt comes from a fresh source IP, so only the per-account lockout can trigger. */
const signIn = async (email: string, password: string) => {
  const res = await POST(
    new Request("http://localhost:3000/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${++ipCounter % 250}` },
      body: JSON.stringify({ email, password }),
    }),
  );
  const body = (await res.json()) as { error?: { code: string; message: string; requestId: string } };
  // The request id is random per call; everything else must be identical between known and unknown accounts.
  return { status: res.status, error: body.error ? { code: body.error.code, message: body.error.message } : null };
};

describe("POST /api/v1/auth/login per-account lockout", () => {
  it("rejects the 6th attempt with a generic RATE_LIMITED, regardless of source IP, for known and unknown emails alike", async () => {
    const known = [];
    const unknown = [];
    for (let i = 0; i < 6; i++) known.push(await signIn("growth@harbor.demo", "wrong-password"));
    for (let i = 0; i < 6; i++) unknown.push(await signIn("no-such-user@harbor.demo", "wrong-password"));

    const invalid = { status: 401, error: { code: "UNAUTHENTICATED", message: "Invalid email or password" } };
    const locked = { status: 429, error: { code: "RATE_LIMITED", message: "Too many sign-in attempts. Try again later." } };
    expect(known).toEqual([invalid, invalid, invalid, invalid, invalid, locked]);
    expect(unknown).toEqual(known);
    // The correct password is refused while locked, with the same generic response.
    expect(await signIn("growth@harbor.demo", "demo-pass-2026")).toEqual(locked);
    // The message reveals nothing account-specific.
    expect(locked.error.message).not.toMatch(/lock|account|exist|user/i);
  });

  it("the lockout response is indistinguishable from the per-IP sign-in limit", async () => {
    for (let i = 0; i < 5; i++) await signIn("viewer@harbor.demo", "wrong-password");
    const lockout = await signIn("viewer@harbor.demo", "wrong-password");

    await client`delete from login_attempts`;
    const ipLimited = [];
    for (let i = 0; i < 21; i++) {
      const res = await POST(
        new Request("http://localhost:3000/api/v1/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
          body: JSON.stringify({ email: `user${i}@example.test`, password: "x" }),
        }),
      );
      ipLimited.push({ status: res.status, error: ((await res.json()) as { error: { code: string; message: string } }).error });
    }
    const last = ipLimited.at(-1)!;
    expect({ status: last.status, error: { code: last.error.code, message: last.error.message } }).toEqual(lockout);
  });
});
