import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInquiry, getInquiryRow, importInquiriesCsv, transitionInquiry } from "../src/services/inquiries";
import { careStarts, cohortStartRate, getDashboard } from "../src/services/metrics";
import { payerId, centerId } from "../src/seed/fixtures";
import { AppError } from "../src/services/context";
import { ANCHOR, harbor, pgError, reseed, testDb } from "./helpers";

const { db, client } = testDb();
beforeAll(() => reseed(db));
afterAll(() => client.end());

const input = (key: string, over: Record<string, unknown> = {}) => ({
  contactAlias: "Demo Family 900",
  serviceZip: "00106",
  payerId: payerId("meridian"),
  preferredModes: ["center" as const],
  preferredWindows: [{ dayOfWeek: 1, startMinute: 840, endMinute: 1080 }],
  requestedDirectHoursPerWeek: 6,
  sourceChannel: "website_form" as const,
  idempotencyKey: key,
  syntheticAcknowledged: true as const,
  ...over,
});
const count = async (q: ReturnType<typeof sql>) => Number(((await db.execute(q)) as unknown as { n: number }[])[0]!.n);

describe("inquiry creation", () => {
  it("creates exactly one inquiry_created event even when the client retries", async () => {
    const a = await createInquiry(db, harbor("intake"), input("idem-key-0001"));
    const b = await createInquiry(db, harbor("intake"), input("idem-key-0001"));
    expect(b.replayed).toBe(true);
    expect(b.inquiry.id).toBe(a.inquiry.id);
    expect(await count(sql`select count(*)::int n from inquiry_events where inquiry_id = ${a.inquiry.id} and event_type = 'inquiry_created'`)).toBe(1);
  });

  it("concurrent retries still produce a single inquiry", async () => {
    const results = await Promise.all([1, 2, 3].map(() => createInquiry(db, harbor("intake"), input("idem-key-race-1"))));
    expect(new Set(results.map((r) => r.inquiry.id)).size).toBe(1);
  });

  it("rejects suspicious real personal contact strings", async () => {
    await expect(createInquiry(db, harbor("intake"), input("idem-key-pii1", { contactAlias: "jane.doe@gmail.com" }))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(createInquiry(db, harbor("intake"), input("idem-key-pii2", { contactAlias: "Demo Family call 619-555-1234" }))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("the database refuses non-synthetic inquiries", async () => {
    await expect(db.execute(sql`update inquiries set synthetic_demo = false where organization_id = ${harbor().orgId}`)).rejects.toThrow();
  });

  it("unrecognized referral codes stay counted as unattributed", async () => {
    const r = await createInquiry(db, harbor("intake"), input("idem-key-ref-x", { referralCode: "NOPE123", sourceChannel: "professional_referral" }));
    expect(r.inquiry.referralCodeId).toBeNull();
    const d = await getDashboard(db, harbor(), { from: new Date(ANCHOR.getTime() - 86_400_000), to: new Date(ANCHOR.getTime() + 1000) });
    expect(d.attribution.unattributed.inquiries).toBeGreaterThan(0);
  });
});

describe("stage transitions", () => {
  it("invalid transitions reject with a typed error and do not mutate the stage", async () => {
    const { inquiry } = await createInquiry(db, harbor("intake"), input("idem-key-tr-1"));
    const err = await transitionInquiry(db, harbor("intake"), inquiry.id, { toStage: "started", eventIdempotencyKey: "tr-invalid-1" }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("INVALID_TRANSITION");
    expect((await getInquiryRow(db, harbor(), inquiry.id)).stage).toBe("new");
  });

  it("events are immutable", async () => {
    expect(await pgError(db.execute(sql`update inquiry_events set event_type = 'x' where organization_id = ${harbor().orgId}`))).toMatch(/IMMUTABLE_RECORD/);
    expect(await pgError(db.execute(sql`delete from inquiry_events where organization_id = ${harbor().orgId}`))).toMatch(/IMMUTABLE_RECORD/);
  });

  it("starting care creates at most one canonical care-start event; cohort metrics use the first start", async () => {
    const ctx = harbor("intake");
    const { inquiry } = await createInquiry(db, ctx, input("idem-key-st-1", { centerId: centerId("west") }));
    const path = ["contacted", "qualified", "benefits_pending", "benefits_verified", "assessment_pending", "authorization_pending", "ready_to_start", "started"] as const;
    for (const [i, s] of path.entries()) await transitionInquiry(db, ctx, inquiry.id, { toStage: s, eventIdempotencyKey: `st-path-${i}` });
    // replay of the final step is idempotent
    const replay = await transitionInquiry(db, ctx, inquiry.id, { toStage: "started", eventIdempotencyKey: "st-path-7" });
    expect(replay.replayed).toBe(true);
    // the DB forbids a second canonical start event outright
    await expect(
      db.execute(sql`insert into inquiry_events (organization_id, inquiry_id, event_type, occurred_at, idempotency_key) values (${ctx.orgId}, ${inquiry.id}, 'care_started_verified_by_staff', ${ANCHOR}, 'dup-start')`),
    ).rejects.toThrow();
    expect(await count(sql`select count(*)::int n from inquiry_events where inquiry_id = ${inquiry.id} and event_type = 'care_started_verified_by_staff'`)).toBe(1);
    const f = { from: new Date(ANCHOR.getTime() - 3600_000), to: new Date(ANCHOR.getTime() + 3600_000), centerId: centerId("west") };
    expect(await careStarts(db, ctx.orgId, f)).toBe(1);
    const c = await cohortStartRate(db, ctx.orgId, f, f.to);
    expect(c.numerator).toBe(1);
  });

  it("rejects impossible timestamps (event before inquiry creation)", async () => {
    const { inquiry } = await createInquiry(db, harbor("intake"), input("idem-key-ts-1"));
    expect(await pgError(db.execute(sql`insert into inquiry_events (organization_id, inquiry_id, event_type, occurred_at, idempotency_key) values (${harbor().orgId}, ${inquiry.id}, 'outreach_attempted', ${new Date(ANCHOR.getTime() - 86_400_000)}, 'ts-bad')`))).toMatch(/EVENT_ORDER/);
  });
});

describe("CSV import", () => {
  const header = "external_id,created_at,contact_alias,service_zip,payer_name,preferred_mode,preferred_day,start_local,end_local,source_channel,referral_code,current_stage";
  const csv = `${header}\nimp-1,2026-09-20T16:00:00Z,Demo Family I1,00104,Meridian Medicaid Plan (DEMO),center,1,15:00,18:00,website_form,,new\nimp-2,2026-09-21T16:00:00Z,Demo Family I2,00107,,home,3,09:00,12:00,professional_referral,BAYPEDS,new`;
  it("previews without writing, imports idempotently and never overwrites", async () => {
    const preview = await importInquiriesCsv(db, harbor("intake"), csv, false);
    expect(preview).toMatchObject({ validRows: 2, newRows: 2, committed: false });
    const first = await importInquiriesCsv(db, harbor("intake"), csv, true);
    expect(first.inserted).toBe(2);
    const second = await importInquiriesCsv(db, harbor("intake"), csv, true);
    expect(second).toMatchObject({ inserted: 0, duplicates: 2 });
  });
  it("viewers cannot import", async () => {
    await expect(importInquiriesCsv(db, harbor("viewer"), csv, false)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
