import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Point the app's pooled client at the dedicated test database before importing server code.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/careflow_test";

const { createDb, login, seedDatabase, getDb } = await import("@careflow/db");
const { route, readJson } = await import("@/lib/server/api");
const { createInquiry } = await import("@careflow/db");

const ORIGIN = "http://localhost:3000";
let token = "";
let viewerToken = "";
const { db: seedDb, client } = createDb(process.env.DATABASE_URL!, { max: 2 });

beforeAll(async () => {
  await seedDatabase(seedDb);
  token = (await login(seedDb, "intake@harbor.demo", "demo-pass-2026"))!.token;
  viewerToken = (await login(seedDb, "viewer@harbor.demo", "demo-pass-2026"))!.token;
});
afterAll(async () => {
  await client.end();
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
    const handler = route("inquiry:create", async ({ ctx, req }) => createInquiry(getDb(), ctx, (await readJson(req)) as never));
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
