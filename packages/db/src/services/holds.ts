/**
 * Transactional capacity reservation (PRD §8, decision A5).
 *
 * A reservation turns a proposed match into a `reserved` capacity hold inside a
 * transaction that first locks the center row (SELECT … FOR UPDATE). Capacity
 * edits update the same row, and every reservation for that center queues on
 * the lock, so the feasibility check (verified hours after holds, BCBA
 * supervision, weekly new-start limit) always sees every committed hold and
 * concurrent reservations can never exceed verified capacity.
 *
 * Reserved is NOT an appointment. Holds expire at `expires_at`: expired holds
 * stop subtracting capacity immediately (lazy expiry at read time) and the
 * `expire-holds` job marks them released for the record.
 */
import { ACTIVE_STAGES, HOLD_DISCLAIMER, reservationCheck } from "@careflow/core";
import { and, asc, desc, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Executor } from "../client";
import { capacityHolds, centers, inquiries, inquiryEvents } from "../schema";
import { audit } from "./audit";
import { loadMatchCenters } from "./capacity";
import { AppError, assertCan, nowOf, type Ctx } from "./context";
import { evaluateParsed, inquiryToMatchRequest } from "./matching";
import { getPolicy } from "./org";
import { getInquiryRow } from "./inquiries";

const DAY = 86_400_000;
const uuid = /^[0-9a-f-]{36}$/i;

export const reserveHoldSchema = z.object({ centerId: z.string().uuid() });
export const releaseHoldSchema = z.object({ reason: z.string().trim().max(200).optional() });

type HoldRow = typeof capacityHolds.$inferSelect;
export type HoldView = HoldRow & { centerName: string; effectiveStatus: "proposed" | "reserved" | "released" | "expired"; active: boolean };

function view(h: HoldRow, centerName: string, now: Date): HoldView {
  const expired = h.status !== "released" && h.expiresAt <= now;
  return { ...h, centerName, effectiveStatus: expired ? "expired" : h.status, active: !expired && h.status !== "released" };
}

async function holdEvent(db: Executor, ctx: Ctx, h: HoldRow, eventType: string, at: Date, metadata: Record<string, unknown>, actorSource = "user") {
  await db.insert(inquiryEvents).values({
    organizationId: ctx.orgId,
    inquiryId: h.inquiryId,
    eventType,
    actorUserId: actorSource === "user" ? ctx.userId : null,
    actorSource,
    occurredAt: at,
    metadata: { holdId: h.id, centerId: h.centerId, ...metadata },
    idempotencyKey: `${eventType}:${h.id}:${at.toISOString()}`,
  });
}

/** Mark holds whose expiry passed as released (reason `expired`). Returns the swept rows. */
async function sweepExpired(db: Executor, ctx: Ctx, now: Date, where: { inquiryId?: string } = {}) {
  const rows = await db
    .update(capacityHolds)
    .set({ status: "released", releasedAt: now, releaseReason: "expired", updatedAt: now })
    .where(
      and(
        eq(capacityHolds.organizationId, ctx.orgId),
        ne(capacityHolds.status, "released"),
        lte(capacityHolds.expiresAt, now),
        where.inquiryId ? eq(capacityHolds.inquiryId, where.inquiryId) : undefined,
      ),
    )
    .returning();
  for (const h of rows) {
    if (h.reservedAt) await holdEvent(db, ctx, h, "capacity_hold_expired", now, { expiredAt: h.expiresAt.toISOString() }, "system");
  }
  return rows;
}

/**
 * POST /inquiries/:id/holds — reserve verified capacity at a center for this
 * inquiry. Idempotent for the same center while the hold is active.
 */
export async function reserveHold(db: Executor, ctx: Ctx, inquiryId: string, input: z.input<typeof reserveHoldSchema>) {
  assertCan(ctx, "hold:reserve");
  const { centerId } = reserveHoldSchema.parse(input);
  const inq = await getInquiryRow(db, ctx, inquiryId);
  if (!(ACTIVE_STAGES as readonly string[]).includes(inq.stage)) {
    throw new AppError("VALIDATION_FAILED", "Capacity can only be reserved for an active inquiry");
  }
  const policy = await getPolicy(db, ctx);
  const now = nowOf(ctx);

  return db.transaction(async (tx) => {
    // 1. Serialize every reservation (and capacity edit) for this center.
    const locked = await tx.execute(
      sql`select id, name from ${centers} where ${centers.organizationId} = ${ctx.orgId} and ${centers.id} = ${centerId} for update`,
    );
    const center = (locked as unknown as { id: string; name: string }[])[0];
    if (!center) throw new AppError("NOT_FOUND", "Center not found");
    // 2. Serialize concurrent reservations for the same inquiry (at different centers).
    await tx.execute(sql`select id from ${inquiries} where ${inquiries.organizationId} = ${ctx.orgId} and ${inquiries.id} = ${inquiryId} for update`);
    await sweepExpired(tx, ctx, now, { inquiryId });

    const existing = await tx
      .select()
      .from(capacityHolds)
      .where(and(eq(capacityHolds.organizationId, ctx.orgId), eq(capacityHolds.inquiryId, inquiryId), inArray(capacityHolds.status, ["proposed", "reserved"])));
    const reserved = existing.find((h) => h.status === "reserved");
    if (reserved) {
      if (reserved.centerId === centerId) return { hold: view(reserved, center.name, now), created: false, disclaimer: HOLD_DISCLAIMER };
      throw new AppError("CONFLICT", "This inquiry already has a reserved hold at another site — release it first", { holdId: reserved.id });
    }

    // 3. Feasibility against committed capacity, excluding this inquiry's own proposals.
    const [mc] = await loadMatchCenters(tx, ctx, { centerId, excludeHoldsForInquiry: inquiryId });
    const result = await evaluateParsed(tx, ctx, inquiryToMatchRequest(inq), mc ? [mc] : []);
    const match = result.matches[0];
    if (!match) throw new AppError("NOT_FOUND", "Center not found");
    const check = reservationCheck(match);
    if (!check.ok) {
      const details = { gates: check.gates.map((g) => ({ key: g.key, status: g.status, reason: g.reason })) };
      if (check.reason === "capacity_conflict") {
        throw new AppError("CONFLICT", `Not enough verified capacity at ${center.name} to reserve — ${check.gates[0]!.label}: ${check.gates[0]!.reason}`, details);
      }
      throw new AppError("VALIDATION_FAILED", "Only a verified potential fit can be reserved — resolve the open verification items first", details);
    }

    // 4. Convert this center's proposal (if any) and supersede proposals elsewhere.
    const expiresAt = new Date(now.getTime() + policy.holdTtlDays * DAY);
    const values = {
      status: "reserved" as const,
      directWeeklyHoursEstimate: check.directWeeklyHours,
      bcbaWeeklyHoursEstimate: check.bcbaWeeklyHours,
      reservedAt: now,
      expiresAt,
      assignedBy: ctx.userId,
      updatedAt: now,
    };
    const proposal = existing.find((h) => h.status === "proposed" && h.centerId === centerId);
    for (const other of existing.filter((h) => h.status === "proposed" && h !== proposal)) {
      await tx
        .update(capacityHolds)
        .set({ status: "released", releasedAt: now, releasedBy: ctx.userId, releaseReason: "superseded", updatedAt: now })
        .where(and(eq(capacityHolds.organizationId, ctx.orgId), eq(capacityHolds.id, other.id)));
    }
    const [hold] = proposal
      ? await tx
          .update(capacityHolds)
          .set(values)
          .where(and(eq(capacityHolds.organizationId, ctx.orgId), eq(capacityHolds.id, proposal.id)))
          .returning()
      : await tx
          .insert(capacityHolds)
          .values({ ...values, organizationId: ctx.orgId, inquiryId, centerId, createdAt: now })
          .returning();
    await holdEvent(tx, ctx, hold!, "capacity_hold_reserved", now, {
      directWeeklyHours: hold!.directWeeklyHoursEstimate,
      expiresAt: expiresAt.toISOString(),
      note: "Reserved capacity hold; not an appointment",
    });
    await audit(tx, ctx, "hold.reserve", "capacity_hold", hold!.id, true, {
      inquiryId,
      centerId,
      directWeeklyHours: hold!.directWeeklyHoursEstimate,
      fromProposal: !!proposal,
    });
    return { hold: view(hold!, center.name, now), created: true, disclaimer: HOLD_DISCLAIMER };
  });
}

/** POST /holds/:id/release — idempotent. */
export async function releaseHold(db: Executor, ctx: Ctx, holdId: string, input: z.input<typeof releaseHoldSchema> = {}) {
  assertCan(ctx, "hold:release");
  const { reason } = releaseHoldSchema.parse(input);
  if (!uuid.test(holdId)) throw new AppError("NOT_FOUND", "Hold not found");
  const now = nowOf(ctx);
  return db.transaction(async (tx) => {
    const [h] = await tx
      .select()
      .from(capacityHolds)
      .where(and(eq(capacityHolds.organizationId, ctx.orgId), eq(capacityHolds.id, holdId)))
      .for("update");
    if (!h) throw new AppError("NOT_FOUND", "Hold not found");
    const [c] = await tx.select({ name: centers.name }).from(centers).where(and(eq(centers.organizationId, ctx.orgId), eq(centers.id, h.centerId)));
    if (h.status === "released") return { hold: view(h, c?.name ?? "", now), released: false };
    const [upd] = await tx
      .update(capacityHolds)
      .set({ status: "released", releasedAt: now, releasedBy: ctx.userId, releaseReason: "staff_released", updatedAt: now })
      .where(and(eq(capacityHolds.organizationId, ctx.orgId), eq(capacityHolds.id, holdId)))
      .returning();
    await holdEvent(tx, ctx, upd!, "capacity_hold_released", now, { previousStatus: h.status, ...(reason ? { reason } : {}) });
    await audit(tx, ctx, "hold.release", "capacity_hold", holdId, true, { inquiryId: h.inquiryId, centerId: h.centerId, previousStatus: h.status });
    return { hold: view(upd!, c?.name ?? "", now), released: true };
  });
}

/** Expiry job: sweep holds past expires_at for the tenant (capacity already ignores them at read time). */
export async function expireHolds(db: Executor, ctx: Ctx) {
  assertCan(ctx, "hold:release");
  const now = nowOf(ctx);
  return db.transaction(async (tx) => {
    const rows = await sweepExpired(tx, ctx, now);
    if (rows.length) await audit(tx, ctx, "hold.expire", "organization", ctx.orgId, true, { expired: rows.length });
    return { expired: rows.length };
  });
}

/** Holds for an inquiry (newest first) plus the caller's affordances. */
export async function listInquiryHolds(db: Executor, ctx: Ctx, inquiryId: string) {
  assertCan(ctx, "inquiry:read");
  await getInquiryRow(db, ctx, inquiryId);
  const now = nowOf(ctx);
  const rows = await db
    .select({ hold: capacityHolds, centerName: centers.name })
    .from(capacityHolds)
    .innerJoin(centers, and(eq(centers.id, capacityHolds.centerId), eq(centers.organizationId, capacityHolds.organizationId)))
    .where(and(eq(capacityHolds.organizationId, ctx.orgId), eq(capacityHolds.inquiryId, inquiryId)))
    .orderBy(desc(capacityHolds.updatedAt), asc(capacityHolds.id));
  return { holds: rows.map((r) => view(r.hold, r.centerName, now)), disclaimer: HOLD_DISCLAIMER };
}
