import { afterAll, describe, expect, it } from "vitest";
import { seedDatabase, storyReference } from "../src/seed";
import { HARBOR } from "../src/seed/fixtures";
import { generateMissions, listMissions } from "../src/services/missions";
import { harbor, reseed, testDb } from "./helpers";

const { db, client } = testDb();
afterAll(async () => {
  await reseed(db);
  await client.end();
});

const HOUR = 3_600_000;
const STORY = ["M1:North Center", "M3:North Center", "M4:South Center"];
const story = async () =>
  (await listMissions(db, { ...harbor(), orgId: HARBOR.id })).map((m) => `${m.ruleId}:${m.centerName ?? "-"}`).sort();
const counts = async () => {
  const [r] = await client`select (select count(*)::int from inquiries where organization_id = ${HARBOR.id}) as inquiries,
    (select count(*)::int from inquiry_events where organization_id = ${HARBOR.id}) as events,
    (select max(occurred_at) from inquiry_events where organization_id = ${HARBOR.id}) as last`;
  return r!;
};

describe("seed story stability", () => {
  it("simulates at the latest 18:00 UTC at or before now", () => {
    for (const [now, ref] of [
      ["2026-10-19T02:41:00Z", "2026-10-18T18:00:00.000Z"],
      ["2026-10-19T17:59:00Z", "2026-10-18T18:00:00.000Z"],
      ["2026-10-19T18:00:00Z", "2026-10-19T18:00:00.000Z"],
      ["2026-10-19T23:30:00Z", "2026-10-19T18:00:00.000Z"],
    ] as const) {
      expect(storyReference(new Date(now)).toISOString(), now).toBe(ref);
    }
  });

  it("the seeded story is identical at any time of day (it used to grow an extra M6 South between ~02:00 and 04:00 UTC)", async () => {
    await seedDatabase(db, { now: new Date("2026-10-04T18:00:00Z") });
    const reference = await counts();
    expect(await story()).toEqual(STORY);
    for (const now of ["2026-10-05T02:41:00Z", "2026-10-05T03:24:00Z", "2026-10-05T09:00:00Z", "2026-10-05T14:35:00Z"]) {
      await seedDatabase(db, { now: new Date(now) });
      expect(await story(), now).toEqual(STORY);
      const c = await counts();
      expect({ inquiries: c.inquiries, events: c.events }, now).toEqual({ inquiries: reference.inquiries, events: reference.events });
      expect(new Date(c.last).getTime(), now).toBeLessThanOrEqual(new Date(now).getTime());
    }
  });

  it("regenerating in a new reporting week refreshes still-unreviewed proposals instead of duplicating them", async () => {
    const anchor = new Date("2026-10-04T18:00:00Z"); // Sunday: +7h is the next reporting week
    await seedDatabase(db, { now: anchor });
    for (const h of [3, 7, 13]) {
      await generateMissions(db, { ...harbor(), now: new Date(anchor.getTime() + h * HOUR) });
      expect(await story(), `+${h}h`).toEqual(STORY);
    }
  });
});
