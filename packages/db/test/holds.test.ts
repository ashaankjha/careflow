import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/client";
import { getCenterCapacity, loadMatchCenters, updateCenterCapacity } from "../src/services/capacity";
import { expireHolds, listInquiryHolds, releaseHold, reserveHold } from "../src/services/holds";
import { createInquiry } from "../src/services/inquiries";
import { centerId, payerId } from "../src/seed/fixtures";
import type { Ctx } from "../src/services/context";
import { ANCHOR, harbor, lakeside, reseed, testDb } from "./helpers";

const { db, client } = testDb();
const url = process.env.TEST_DATABASE_URL!;
afterAll(() => client.end());

const DAY = 86_400_000;
const SOUTH = centerId("south");
const MONDAY_MORNING = [{ dayOfWeek: 1, startMinute: 540, endMinute: 720 }];
let seq = 0;

async function southInquiry(hours = 3) {
  seq++;
  const r = await createInquiry(db, harbor("intake"), {
    contactAlias: `Demo Family H${seq}`,
    serviceZip: "00111",
    payerId: payerId("cascade"),
    preferredModes: ["center"],
    preferredWindows: MONDAY_MORNING,
    requestedDirectHoursPerWeek: hours,
    sourceChannel: "website_form",
    idempotencyKey: `hold-test-inquiry-${seq}`,
    syntheticAcknowledged: true,
  });
  return r.inquiry.id;
}

/** South: one verified Monday-morning RBT window with `rbtHours`, generous BCBA, optional weekly new-start limit. */
async function configureSouth(rbtHours: number, maxNew: number | null) {
  const ops = harbor("ops");
  const cap = await getCenterCapacity(db, ops, SOUTH);
  // free the seeded proposals so the arithmetic below is exact
  for (const h of cap.holds.filter((x) => x.status === "proposed")) await releaseHold(db, ops, h.id);
  await updateCenterCapacity(db, ops, SOUTH, {
    version: cap.version,
    attestVerified: true,
    windows: [
      { role: "RBT", dayOfWeek: 1, startMinute: 540, endMinute: 720, weeklyAvailableHours: rbtHours, serviceMode: "center" },
      { role: "BCBA", dayOfWeek: 1, startMinute: 480, endMinute: 1020, weeklyAvailableHours: 40, serviceMode: "center" },
    ],
    rules: [{ payerId: null, requiredBcbaHoursPerDirectHour: 0.1, minRbtCoverage: 1, maxNewStartsPerWeek: maxNew, isVerified: true }],
  });
}

/** Fire reservations in parallel, each on its own connection (separate sessions/transactions). */
async function raceReservations(inquiryIds: string[], ctx: Ctx = harbor("intake")) {
  const conns = inquiryIds.map(() => createDb(url, { max: 1 }));
  try {
    return await Promise.allSettled(inquiryIds.map((id, i) => reserveHold(conns[i]!.db, ctx, id, { centerId: SOUTH })));
  } finally {
    await Promise.all(conns.map((c) => c.client.end()));
  }
}

const reservedHours = async () =>
  Number(
    ((await db.execute(
      sql`select coalesce(sum(direct_weekly_hours_estimate), 0)::float8 h from capacity_holds where center_id = ${SOUTH} and status = 'reserved'`,
    )) as unknown as { h: number }[])[0]!.h,
  );

describe("concurrent reservations never exceed verified capacity", () => {
  beforeAll(() => reseed(db));

  it("verified hours: 10 h/wk with 3 h requests → exactly 3 of 8 parallel reservations succeed", async () => {
    await configureSouth(10, null);
    const ids = [];
    for (let i = 0; i < 8; i++) ids.push(await southInquiry(3));
    const results = await raceReservations(ids);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(3);
    expect(failed).toHaveLength(5);
    for (const f of failed) expect(f.reason).toMatchObject({ code: "CONFLICT" });
    expect(await reservedHours()).toBe(9);
  });

  it("weekly new-start limit: exactly the remaining slots succeed even with ample hours", async () => {
    await configureSouth(40, null);
    const [south] = await loadMatchCenters(db, harbor(), { centerId: SOUTH });
    // already committed: verified starts in the last 7 days + the 3 holds above
    const committed = south!.startsLast7Days + south!.holds.length;
    expect(south!.holds).toHaveLength(3);
    await configureSouth(40, committed + 2);
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push(await southInquiry(1));
    const results = await raceReservations(ids);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/new-start/i) });
  });
});

describe("hold lifecycle", () => {
  beforeAll(async () => {
    await reseed(db);
    await configureSouth(6, null);
  });

  it("only roles with hold:reserve may reserve", async () => {
    const id = await southInquiry(3);
    await expect(reserveHold(db, harbor("viewer"), id, { centerId: SOUTH })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reserveHold(db, harbor("growth"), id, { centerId: SOUTH })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("reserves, is idempotent per center, records an event and refuses a second site", async () => {
    const id = await southInquiry(3);
    const a = await reserveHold(db, harbor("intake"), id, { centerId: SOUTH });
    expect(a.created).toBe(true);
    expect(a.hold.status).toBe("reserved");
    expect(a.hold.directWeeklyHoursEstimate).toBe(3);
    expect(a.hold.bcbaWeeklyHoursEstimate).toBeCloseTo(0.3);
    expect(a.hold.expiresAt.getTime()).toBe(ANCHOR.getTime() + 7 * DAY);
    expect(a.disclaimer).toMatch(/not an appointment/);
    const again = await reserveHold(db, harbor("ops"), id, { centerId: SOUTH });
    expect(again).toMatchObject({ created: false, hold: { id: a.hold.id } });
    await expect(reserveHold(db, harbor("intake"), id, { centerId: centerId("west") })).rejects.toMatchObject({ code: "CONFLICT" });
    const ev = (await db.execute(
      sql`select event_type, metadata from inquiry_events where inquiry_id = ${id} and event_type like 'capacity_hold%'`,
    )) as unknown as { event_type: string; metadata: { note: string } }[];
    expect(ev).toHaveLength(1);
    expect(ev[0]!.metadata.note).toMatch(/not an appointment/);
  });

  it("a reserved hold subtracts capacity until it is released", async () => {
    const id = await southInquiry(3);
    await expect(reserveHold(db, harbor("intake"), id, { centerId: SOUTH })).resolves.toMatchObject({ created: true });
    const blocked = await southInquiry(3);
    await expect(reserveHold(db, harbor("intake"), blocked, { centerId: SOUTH })).rejects.toMatchObject({ code: "CONFLICT" });
    const { holds } = await listInquiryHolds(db, harbor("viewer"), id);
    const rel = await releaseHold(db, harbor("ops"), holds[0]!.id, { reason: "family chose another provider" });
    expect(rel).toMatchObject({ released: true, hold: { status: "released", releaseReason: "staff_released", active: false } });
    expect(await releaseHold(db, harbor("ops"), holds[0]!.id)).toMatchObject({ released: false });
    await expect(reserveHold(db, harbor("intake"), blocked, { centerId: SOUTH })).resolves.toMatchObject({ created: true });
  });

  it("a verification-needed match cannot be reserved", async () => {
    const r = await createInquiry(db, harbor("intake"), {
      contactAlias: "Demo Family Meridian",
      serviceZip: "00106",
      payerId: payerId("meridian"),
      preferredModes: ["center"],
      preferredWindows: [1, 3, 4].map((d) => ({ dayOfWeek: d, startMinute: 840, endMinute: 1080 })),
      requestedDirectHoursPerWeek: 6,
      sourceChannel: "phone",
      idempotencyKey: "hold-test-meridian",
      syntheticAcknowledged: true,
    });
    await expect(reserveHold(db, harbor("intake"), r.inquiry.id, { centerId: centerId("west") })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("expired holds stop subtracting capacity immediately and the job records them", async () => {
    const later = { ...harbor("intake"), now: new Date(ANCHOR.getTime() + 8 * DAY) };
    const [south] = await loadMatchCenters(db, later, { centerId: SOUTH });
    expect(south!.holds).toHaveLength(0); // lazy expiry at read time
    const swept = await expireHolds(db, { ...harbor("admin"), now: later.now });
    expect(swept.expired).toBeGreaterThan(0);
    const rows = (await db.execute(
      sql`select count(*)::int n from capacity_holds where center_id = ${SOUTH} and status <> 'released'`,
    )) as unknown as { n: number }[];
    expect(rows[0]!.n).toBe(0);
    const ev = (await db.execute(
      sql`select count(*)::int n from inquiry_events where organization_id = ${harbor().orgId} and event_type = 'capacity_hold_expired'`,
    )) as unknown as { n: number }[];
    expect(ev[0]!.n).toBe(swept.expired);
    expect((await expireHolds(db, { ...harbor("admin"), now: later.now })).expired).toBe(0);
  });

  it("holds are tenant-scoped", async () => {
    const id = await southInquiry(1);
    const { holds } = await listInquiryHolds(db, harbor(), id);
    expect(holds).toHaveLength(0);
    await expect(listInquiryHolds(db, lakeside(), id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const [any] = (await db.execute(sql`select id from capacity_holds where organization_id = ${harbor().orgId} limit 1`)) as unknown as { id: string }[];
    await expect(releaseHold(db, lakeside(), any!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(reserveHold(db, lakeside(), id, { centerId: SOUTH })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("seeded proposals", () => {
  beforeAll(() => reseed(db));

  it("reserving converts the inquiry's proposed hold in place instead of double counting it", async () => {
    const [proposal] = (await db.execute(
      sql`select id, inquiry_id from capacity_holds where center_id = ${SOUTH} and status = 'proposed' order by id limit 1`,
    )) as unknown as { id: string; inquiry_id: string }[];
    const r = await reserveHold(db, harbor("ops"), proposal!.inquiry_id, { centerId: SOUTH });
    expect(r.hold.id).toBe(proposal!.id);
    expect(r.hold.status).toBe("reserved");
    expect(r.hold.reservedAt?.getTime()).toBe(ANCHOR.getTime());
  });
});
