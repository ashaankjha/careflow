import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/careflow_test";
process.env.APP_DATABASE_URL = process.env.TEST_APP_DATABASE_URL ?? "postgres://careflow_app:careflow_app_dev_only@localhost:5432/careflow_test";

const { createDb, getAppDb, login, seedDatabase } = await import("@careflow/db");
const { GET } = await import("@/app/api/v1/equity/route");

const ORIGIN = "http://localhost:3000";
const { db: seedDb, client } = createDb(process.env.DATABASE_URL!, { max: 2 });
const tokens: Record<string, string> = {};

beforeAll(async () => {
  await seedDatabase(seedDb);
  await client`delete from rate_limit_buckets`;
  for (const role of ["growth", "ops", "intake", "viewer"]) tokens[role] = (await login(getAppDb(), `${role}@harbor.demo`, "demo-pass-2026"))!.token;
});
afterAll(() => client.end());

const get = (qs: string, role: string) =>
  GET(new Request(`${ORIGIN}/api/v1/equity${qs}`, { headers: { cookie: `cf_session=${tokens[role]}`, host: "localhost:3000" } }), { params: Promise.resolve({}) });

describe("GET /api/v1/equity", () => {
  it("returns the aggregate report with the equity-only notice for growth and ops", async () => {
    for (const role of ["growth", "ops"]) {
      const res = await get("?days=90", role);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.notice).toMatch(/never used for scoring, ranking, matching or exclusion/);
      expect(body.minCellSize).toBe(5);
      expect(body.groups.length).toBeGreaterThan(0);
    }
  });
  it("is forbidden for intake and viewer roles", async () => {
    for (const role of ["intake", "viewer"]) {
      const res = await get("", role);
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("FORBIDDEN");
    }
  });
  it("validates query parameters", async () => {
    expect((await get("?days=abc", "growth")).status).toBe(422);
    expect((await get("?centerId=not-a-uuid", "growth")).status).toBe(422);
  });
});
