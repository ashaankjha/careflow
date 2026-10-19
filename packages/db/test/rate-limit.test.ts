import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { hitRateLimit } from "../src/services/rate-limit";
import { testAppDb, testDb } from "./helpers";

// Two independent pools stand in for two app processes/nodes.
const nodeA = testAppDb(4);
const nodeB = testAppDb(4);
const owner = testDb();
afterAll(async () => {
  await Promise.all([nodeA.client.end(), nodeB.client.end(), owner.client.end()]);
});
beforeEach(async () => {
  await owner.db.execute(sql`delete from rate_limit_buckets`);
});

describe("shared fixed-window rate limiter", () => {
  it("allows up to the limit then rejects, per key", async () => {
    const seen = [];
    for (let i = 0; i < 4; i++) seen.push((await hitRateLimit(nodeA.db, "u1:w", 3, 60)).allowed);
    expect(seen).toEqual([true, true, true, false]);
    expect((await hitRateLimit(nodeA.db, "u2:w", 3, 60)).allowed).toBe(true);
  });

  it("counts are shared across processes and atomic under concurrency", async () => {
    const hits = await Promise.all(Array.from({ length: 30 }, (_, i) => hitRateLimit(i % 2 ? nodeA.db : nodeB.db, "shared:r", 20, 60)));
    expect(hits.map((h) => h.hits).sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(hits.filter((h) => h.allowed)).toHaveLength(20);
  });

  it("starts a fresh window once the previous one has elapsed", async () => {
    for (let i = 0; i < 3; i++) await hitRateLimit(nodeA.db, "u3:w", 2, 60);
    expect((await hitRateLimit(nodeB.db, "u3:w", 2, 60)).allowed).toBe(false);
    await owner.db.execute(sql`update rate_limit_buckets set window_start = window_start - interval '61 seconds' where key = 'u3:w'`);
    expect(await hitRateLimit(nodeB.db, "u3:w", 2, 60)).toEqual({ allowed: true, hits: 1 });
  });
});
