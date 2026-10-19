import {
  capacityUpdateSchema,
  findOverlappingWindows,
  payerUpdateSchema,
  verifiedDirectHoursAvailable,
  type MatchCenter,
  type PayerStatus,
  type ServiceMode,
  type StaffRole,
} from "@careflow/core";
import { and, asc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db, Executor } from "../client";
import {
  capacityHolds,
  capacityRules,
  centerPayers,
  centers,
  inquiries,
  inquiryEvents,
  payers,
  staffCapacityWindows,
} from "../schema";
import { audit } from "./audit";
import { AppError, assertCan, nowOf, type Ctx } from "./context";
import { getPolicy } from "./org";

const DAY = 86_400_000;

export async function listCenters(db: Executor, ctx: Ctx) {
  return db.select().from(centers).where(eq(centers.organizationId, ctx.orgId)).orderBy(asc(centers.name));
}

export async function getCenter(db: Executor, ctx: Ctx, id: string) {
  const [c] = await db
    .select()
    .from(centers)
    .where(and(eq(centers.organizationId, ctx.orgId), eq(centers.id, id)));
  if (!c) throw new AppError("NOT_FOUND", "Center not found");
  return c;
}

export async function listPayers(db: Executor, ctx: Ctx) {
  return db.select().from(payers).where(eq(payers.organizationId, ctx.orgId)).orderBy(asc(payers.name));
}

/** Load every center with the data the matcher needs, scoped to the tenant. */
export async function loadMatchCenters(db: Executor, ctx: Ctx): Promise<MatchCenter[]> {
  const now = nowOf(ctx);
  const org = ctx.orgId;
  const [cs, cps, ws, rs, hs, starts, backlog] = await Promise.all([
    db.select().from(centers).where(eq(centers.organizationId, org)).orderBy(asc(centers.id)),
    db.select().from(centerPayers).where(eq(centerPayers.organizationId, org)),
    db.select().from(staffCapacityWindows).where(eq(staffCapacityWindows.organizationId, org)),
    db.select().from(capacityRules).where(eq(capacityRules.organizationId, org)),
    db
      .select()
      .from(capacityHolds)
      .where(and(eq(capacityHolds.organizationId, org), ne(capacityHolds.status, "released"), gt(capacityHolds.expiresAt, now))),
    db
      .select({ centerId: inquiries.centerId, n: sql<number>`count(distinct ${inquiryEvents.inquiryId})::int` })
      .from(inquiryEvents)
      .innerJoin(inquiries, and(eq(inquiries.id, inquiryEvents.inquiryId), eq(inquiries.organizationId, inquiryEvents.organizationId)))
      .where(
        and(
          eq(inquiryEvents.organizationId, org),
          eq(inquiryEvents.eventType, "care_started_verified_by_staff"),
          gt(inquiryEvents.occurredAt, new Date(now.getTime() - 7 * DAY)),
        ),
      )
      .groupBy(inquiries.centerId),
    db
      .select({ centerId: inquiries.centerId, n: sql<number>`count(*)::int` })
      .from(inquiries)
      .where(
        and(
          eq(inquiries.organizationId, org),
          inArray(inquiries.stage, ["benefits_pending", "benefits_verified", "assessment_pending", "authorization_pending", "ready_to_start"]),
        ),
      )
      .groupBy(inquiries.centerId),
  ]);
  const isEffective = (w: (typeof ws)[number]) =>
    (!w.effectiveFrom || w.effectiveFrom <= now) && (!w.effectiveTo || w.effectiveTo > now);
  return cs.map((c) => ({
    id: c.id,
    name: c.name,
    active: c.active,
    latitude: c.latitude,
    longitude: c.longitude,
    serviceModes: c.serviceModes as ServiceMode[],
    serviceRadiusMiles: c.serviceRadiusMiles,
    acceptedAgeMin: c.acceptedAgeMin,
    acceptedAgeMax: c.acceptedAgeMax,
    payers: cps
      .filter((p) => p.centerId === c.id)
      .map((p) => ({ payerId: p.payerId, status: p.status as PayerStatus, lastVerifiedAt: p.lastVerifiedAt })),
    windows: ws
      .filter((w) => w.centerId === c.id && isEffective(w))
      .map((w) => ({
        role: w.role as StaffRole,
        dayOfWeek: w.dayOfWeek,
        startMinute: w.startMinute,
        endMinute: w.endMinute,
        weeklyAvailableHours: w.weeklyAvailableHours,
        serviceMode: w.serviceMode as ServiceMode,
        verifiedAt: w.verifiedAt,
      })),
    rules: rs
      .filter((r) => r.centerId === c.id)
      .map((r) => ({
        payerId: r.payerId,
        requiredBcbaHoursPerDirectHour: r.requiredBcbaHoursPerDirectHour,
        maxNewStartsPerWeek: r.maxNewStartsPerWeek,
        isVerified: r.isVerified,
      })),
    holds: hs
      .filter((h) => h.centerId === c.id)
      .map((h) => ({ directWeeklyHours: h.directWeeklyHoursEstimate, bcbaWeeklyHours: h.bcbaWeeklyHoursEstimate })),
    startsLast7Days: starts.find((s) => s.centerId === c.id)?.n ?? 0,
    onboardingBacklog: backlog.find((b) => b.centerId === c.id)?.n ?? 0,
  }));
}

/** Per-center capacity summary (verified hours for new starts, pending hours, holds). */
export async function capacitySummaries(db: Executor, ctx: Ctx) {
  const policy = await getPolicy(db, ctx);
  const mcs = await loadMatchCenters(db, ctx);
  return mcs.map((c) => ({ centerId: c.id, ...verifiedDirectHoursAvailable(c, { now: nowOf(ctx), policy }) }));
}

export async function getCenterCapacity(db: Executor, ctx: Ctx, centerId: string) {
  assertCan(ctx, "capacity:read");
  const center = await getCenter(db, ctx, centerId);
  const [windows, rules, holds, cps] = await Promise.all([
    db
      .select()
      .from(staffCapacityWindows)
      .where(and(eq(staffCapacityWindows.organizationId, ctx.orgId), eq(staffCapacityWindows.centerId, centerId)))
      .orderBy(asc(staffCapacityWindows.role), asc(staffCapacityWindows.dayOfWeek), asc(staffCapacityWindows.startMinute)),
    db
      .select()
      .from(capacityRules)
      .where(and(eq(capacityRules.organizationId, ctx.orgId), eq(capacityRules.centerId, centerId))),
    db
      .select()
      .from(capacityHolds)
      .where(
        and(
          eq(capacityHolds.organizationId, ctx.orgId),
          eq(capacityHolds.centerId, centerId),
          ne(capacityHolds.status, "released"),
          gt(capacityHolds.expiresAt, nowOf(ctx)),
        ),
      ),
    db
      .select({
        payerId: centerPayers.payerId,
        status: centerPayers.status,
        lastVerifiedAt: centerPayers.lastVerifiedAt,
        notes: centerPayers.notes,
        payerName: payers.name,
      })
      .from(centerPayers)
      .innerJoin(payers, and(eq(payers.id, centerPayers.payerId), eq(payers.organizationId, centerPayers.organizationId)))
      .where(and(eq(centerPayers.organizationId, ctx.orgId), eq(centerPayers.centerId, centerId)))
      .orderBy(asc(payers.name)),
  ]);
  return { center, version: center.capacityVersion, windows, rules, holds, payers: cps };
}

/**
 * Replace a center's capacity sheet. Optimistic locking on capacity_version;
 * saving as ops attests the sheet as verified now (PRD: ops publishes capacity).
 */
export async function updateCenterCapacity(
  db: Db,
  ctx: Ctx,
  centerId: string,
  input: z.input<typeof capacityUpdateSchema>,
) {
  assertCan(ctx, "capacity:edit");
  const data = capacityUpdateSchema.parse(input);
  const overlaps = findOverlappingWindows(data.windows);
  if (overlaps.length) {
    throw new AppError("VALIDATION_FAILED", "Capacity windows overlap for the same role/day/mode", { overlaps });
  }
  const now = nowOf(ctx);
  const center = await getCenter(db, ctx, centerId);
  const modes = new Set(center.serviceModes);
  const badMode = data.windows.find((w) => !modes.has(w.serviceMode));
  if (badMode) throw new AppError("VALIDATION_FAILED", `Site does not offer service mode ${badMode.serviceMode}`);
  const orgPayers = new Set((await listPayers(db, ctx)).map((p) => p.id));
  if (data.rules.some((r) => r.payerId && !orgPayers.has(r.payerId))) throw new AppError("NOT_FOUND", "Payer not found");

  return db.transaction(async (tx) => {
    const updated = await tx
      .update(centers)
      .set({
        capacityVersion: sql`${centers.capacityVersion} + 1`,
        capacityVerifiedAt: data.attestVerified ? now : center.capacityVerifiedAt,
        capacityVerifiedBy: data.attestVerified ? ctx.userId : center.capacityVerifiedBy,
        updatedAt: now,
      })
      .where(and(eq(centers.organizationId, ctx.orgId), eq(centers.id, centerId), eq(centers.capacityVersion, data.version)))
      .returning({ version: centers.capacityVersion });
    if (updated.length === 0) {
      throw new AppError("CONFLICT", "Capacity was changed by someone else — reload and re-apply your edits");
    }
    await tx
      .delete(staffCapacityWindows)
      .where(and(eq(staffCapacityWindows.organizationId, ctx.orgId), eq(staffCapacityWindows.centerId, centerId)));
    if (data.windows.length) {
      await tx.insert(staffCapacityWindows).values(
        data.windows.map((w) => ({
          organizationId: ctx.orgId,
          centerId,
          role: w.role,
          dayOfWeek: w.dayOfWeek,
          startMinute: w.startMinute,
          endMinute: w.endMinute,
          weeklyAvailableHours: w.weeklyAvailableHours,
          serviceMode: w.serviceMode,
          verifiedAt: data.attestVerified ? now : null,
          verifiedBy: data.attestVerified ? ctx.userId : null,
          effectiveFrom: now,
        })),
      );
    }
    await tx.delete(capacityRules).where(and(eq(capacityRules.organizationId, ctx.orgId), eq(capacityRules.centerId, centerId)));
    if (data.rules.length) {
      await tx.insert(capacityRules).values(
        data.rules.map((r) => ({
          organizationId: ctx.orgId,
          centerId,
          payerId: r.payerId,
          requiredBcbaHoursPerDirectHour: r.requiredBcbaHoursPerDirectHour,
          minRbtCoverage: r.minRbtCoverage,
          maxNewStartsPerWeek: r.maxNewStartsPerWeek,
          isVerified: r.isVerified,
        })),
      );
    }
    await audit(tx, ctx, "capacity.update", "center", centerId, true, {
      windows: data.windows.length,
      totalRbtHours: data.windows.filter((w) => w.role === "RBT").reduce((s, w) => s + w.weeklyAvailableHours, 0),
      attested: data.attestVerified,
      version: updated[0]!.version,
    });
    return { version: updated[0]!.version, verifiedAt: data.attestVerified ? now.toISOString() : null };
  });
}

export async function updateCenterPayers(db: Db, ctx: Ctx, centerId: string, input: z.input<typeof payerUpdateSchema>) {
  assertCan(ctx, "payer:edit");
  const data = payerUpdateSchema.parse(input);
  await getCenter(db, ctx, centerId);
  const orgPayers = new Set((await listPayers(db, ctx)).map((p) => p.id));
  if (data.payers.some((p) => !orgPayers.has(p.payerId))) throw new AppError("NOT_FOUND", "Payer not found");
  const now = nowOf(ctx);
  await db.transaction(async (tx) => {
    for (const p of data.payers) {
      await tx
        .insert(centerPayers)
        .values({
          organizationId: ctx.orgId,
          centerId,
          payerId: p.payerId,
          status: p.status,
          lastVerifiedAt: p.status === "unknown" ? null : now,
          verifiedBy: p.status === "unknown" ? null : ctx.userId,
          notes: p.notes ?? null,
        })
        .onConflictDoUpdate({
          target: [centerPayers.centerId, centerPayers.payerId],
          set: {
            status: p.status,
            lastVerifiedAt: p.status === "unknown" ? null : now,
            verifiedBy: p.status === "unknown" ? null : ctx.userId,
            notes: p.notes ?? null,
            updatedAt: now,
          },
          setWhere: eq(centerPayers.organizationId, ctx.orgId),
        });
    }
    await audit(tx, ctx, "payers.update", "center", centerId, true, {
      changes: data.payers.map((p) => ({ payerId: p.payerId, status: p.status })),
    });
  });
  return getCenterCapacity(db, ctx, centerId);
}
