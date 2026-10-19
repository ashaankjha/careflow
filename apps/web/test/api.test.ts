import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Point the app's pooled clients (owner + least-privilege app role) at the dedicated test database before importing server code.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/careflow_test";
process.env.APP_DATABASE_URL = process.env.TEST_APP_DATABASE_URL ?? "postgres://careflow_app:careflow_app_dev_only@localhost:5432/careflow_test";

const { createDb, login, seedDatabase, getAppDb, sql, HARBOR } = await import("@careflow/db");
const { db: scopedDb, withOrg } = await import("@/lib/server/db");
const { rateLimit } = await import("@/lib/server/rate-limit");
const { route, readJson } = await import("@/lib/server/api");
const { createInquiry } = await import("@careflow/db");

const ORIGIN = "http://localhost:3000";
let token = "";
let viewerToken = "";
const { db: seedDb, client } = createDb(process.env.DATABASE_URL!, { max: 2 });

beforeAll(async () => {
  await seedDatabase(seedDb);
  token = (await login(getAppDb(), "intake@harbor.demo", "demo-pass-2026"))!.token;
  viewerToken = (await login(getAppDb(), "viewer@harbor.demo", "demo-pass-2026"))!.token;
});
afterAll(async () => {
  await client.end();
});

beforeEach(async () => {
  // Rate-limit counters are shared state in Postgres; start every test with a fresh window.
  await client`delete from rate_limit_buckets`;
});

const req = (method: string, body: unknown, tok = token, origin = ORIGIN) =>
  new Request(`${ORIGIN}/api/v1/inquiries`, {
    method,
    headers: { "content-type": "application/json", cookie: `cf_session=${tok}`, origin, host: "localhost:3000" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctxArg = { params: Promise.resolve({}) };

describe("API route wrapper", () => {
  it("never logs request bodies, even when the handler fails unexpectedly", async () => {
    const spies = [vi.spyOn(console, "error").mockImplementation(() => {}), vi.spyOn(console, "log").mockImplementation(() => {}), vi.spyOn(console, "warn").mockImplementation(() => {})];
    const handler = route("inquiry:create", async ({ req }) => {
      await readJson(req);
      throw new Error("boom with secret Demo Family 4242 inside");
    });
    const res = await handler(req("POST", { contactAlias: "Demo Family 4242", notes: "sensitive-note" }), ctxArg);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "INTERNAL", message: "Unexpected server error" });
    expect(body.error.requestId).toBeTruthy();
    const logged = spies.flatMap((s) => s.mock.calls.flat()).join(" ");
    expect(logged).not.toMatch(/Demo Family 4242|sensitive-note|secret/);
    spies.forEach((s) => s.mockRestore());
  });

  it("rejects cross-origin mutations (CSRF)", async () => {
    const handler = route("inquiry:create", async () => ({ ok: true }));
    const res = await handler(req("POST", {}, token, "https://evil.example"), ctxArg);
    expect(res.status).toBe(403);
  });

  it("enforces RBAC server-side and returns the error envelope", async () => {
    const handler = route("capacity:edit", async () => ({ ok: true }));
    const res = await handler(req("PUT", {}, viewerToken), ctxArg);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
    const anon = await handler(req("PUT", {}, "bogus"), ctxArg);
    expect(anon.status).toBe(401);
  });

  it("validation errors return 422 with field paths, not stack traces", async () => {
    const handler = route("inquiry:create", async ({ ctx, req, db }) => createInquiry(db, ctx, (await readJson(req)) as never));
    const res = await handler(req("POST", { contactAlias: "x" }), ctxArg);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(JSON.stringify(body)).not.toMatch(/at .*\.ts/);
  });

  it("rejects non-JSON bodies (no file attachments in demo mode)", async () => {
    const handler = route("inquiry:import", async ({ req }) => readJson(req));
    const r = new Request(`${ORIGIN}/api/v1/inquiries/import`, { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x", cookie: `cf_session=${token}`, origin: ORIGIN, host: "localhost:3000" }, body: "--x--" });
    const res = await handler(r, ctxArg);
    expect(res.status).toBe(422);
  });
});

describe("tenant-scoped request transaction (app role + RLS)", () => {
  it("runs every handler as the non-owner app role with app.current_org set to the session's org", async () => {
    const handler = route(null, async ({ db, ctx }) => {
      const r = (await db.execute(sql`select current_user as u, current_setting('app.current_org', true) as org`)) as unknown as { u: string; org: string }[];
      return { ...r[0], ctxOrg: ctx.orgId, same: scopedDb() === db };
    });
    const body = await (await handler(req("GET", undefined), ctxArg)).json();
    expect(body).toEqual({ u: "careflow_app", org: HARBOR.id, ctxOrg: HARBOR.id, same: true });
  });

  it("db() fails loudly outside a tenant scope and the tenant never leaks onto the pooled connection", async () => {
    expect(() => scopedDb()).toThrow(/outside a tenant scope/);
    expect(await withOrg({ orgId: HARBOR.id }, async (db) => ((await db.execute(sql`select count(*)::int n from inquiries`)) as unknown as { n: number }[])[0]!.n)).toBeGreaterThan(0);
    const rows = (await getAppDb().execute(sql`select coalesce(current_setting('app.current_org', true), '') as org, (select count(*)::int from inquiries) as n`)) as unknown as { org: string; n: number }[];
    expect(rows[0]).toEqual({ org: "", n: 0 });
  });
});

describe("shared rate limiter", () => {
  it("returns 429 once the user's window budget is spent (counter lives in Postgres, not process memory)", async () => {
    const handler = route(null, async () => ({ ok: true }));
    expect((await handler(req("GET", undefined), ctxArg)).status).toBe(200);
    // Another process/node exhausting the same budget is visible here because the counter is shared.
    await client`update rate_limit_buckets set hits = 300 where key like ${"%:r"}`;
    const res = await handler(req("GET", undefined), ctxArg);
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
  });

  it("limits sign-in attempts per key", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rateLimit("login:test-ip", 3, 60));
    expect(results).toEqual([true, true, true, false]);
  });
});
