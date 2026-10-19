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
import { and, asc, desc, eq, gt, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { z } from "zod";
import type { Db, Executor } from "../client";
import {
  capacityHolds,
  capacityRules,
  capacityVersions,
  centerPayers,
  centers,
  inquiries,
  inquiryEvents,
  payers,
  staffCapacityWindows,
  staffCapacityWindowVersions,
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

type CenterRow = typeof centers.$inferSelect;
type CenterPayerRow = typeof centerPayers.$inferSelect;
type WindowLike = Pick<
  typeof staffCapacityWindows.$inferSelect,
  "role" | "dayOfWeek" | "startMinute" | "endMinute" | "weeklyAvailableHours" | "serviceMode" | "verifiedAt"
>;
type RuleLike = {
  payerId: string | null;
  requiredBcbaHoursPerDirectHour: number | null;
  maxNewStartsPerWeek: number | null;
  isVerified: boolean;
};
type HoldLike = { directWeeklyHoursEstimate: number; bcbaWeeklyHoursEstimate: number };

function toMatchCenter(
  c: CenterRow,
  parts: {
    payers: CenterPayerRow[];
    windows: WindowLike[];
    rules: RuleLike[];
    holds: HoldLike[];
    startsLast7Days: number;
    onboardingBacklog: number;
    /** As-of evaluation: payer participation is not versioned, so verification time is capped at the as-of instant. */
    payerAsOf?: Date;
  },
): MatchCenter {
  return {
    id: c.id,
    name: c.name,
    active: c.active,
    latitude: c.latitude,
    longitude: c.longitude,
    serviceModes: c.serviceModes as ServiceMode[],
    serviceRadiusMiles: c.serviceRadiusMiles,
    acceptedAgeMin: c.acceptedAgeMin,
    acceptedAgeMax: c.acceptedAgeMax,
    payers: parts.payers.map((p) => ({
      payerId: p.payerId,
      status: p.status as PayerStatus,
      lastVerifiedAt:
        parts.payerAsOf && p.lastVerifiedAt && p.lastVerifiedAt > parts.payerAsOf ? parts.payerAsOf : p.lastVerifiedAt,
    })),
    windows: parts.windows.map((w) => ({
      role: w.role as StaffRole,
      dayOfWeek: w.dayOfWeek,
      startMinute: w.startMinute,
      endMinute: w.endMinute,
      weeklyAvailableHours: w.weeklyAvailableHours,
      serviceMode: w.serviceMode as ServiceMode,
      verifiedAt: w.verifiedAt,
    })),
    rules: parts.rules.map((r) => ({
      payerId: r.payerId,
      requiredBcbaHoursPerDirectHour: r.requiredBcbaHoursPerDirectHour,
      maxNewStartsPerWeek: r.maxNewStartsPerWeek,
      isVerified: r.isVerified,
    })),
    holds: parts.holds.map((h) => ({ directWeeklyHours: h.directWeeklyHoursEstimate, bcbaWeeklyHours: h.bcbaWeeklyHoursEstimate })),
    startsLast7Days: parts.startsLast7Days,
    onboardingBacklog: parts.onboardingBacklog,
  };
}

const ONBOARDING_STAGES = ["benefits_pending", "benefits_verified", "assessment_pending", "authorization_pending", "ready_to_start"] as const;

async function onboardingBacklogByCenter(db: Executor, org: string) {
  return db
    .select({ centerId: inquiries.centerId, n: sql<number>`count(*)::int` })
    .from(inquiries)
    .where(and(eq(inquiries.organizationId, org), inArray(inquiries.stage, [...ONBOARDING_STAGES])))
    .groupBy(inquiries.centerId);
}

export type LoadMatchCentersOptions = {
  /** Restrict to one center (used inside the reservation transaction). */
  centerId?: string;
  /** Ignore this inquiry's own holds (they are replaced when it is reserved). */
  excludeHoldsForInquiry?: string;
};

/**
 * Load every center with the data the matcher needs, scoped to the tenant,
 * using the CURRENT capacity sheet. Holds that are released or past expires_at
 * never subtract capacity (lazy expiry at read time).
 */
export async function loadMatchCenters(db: Executor, ctx: Ctx, opts: LoadMatchCentersOptions = {}): Promise<MatchCenter[]> {
  const now = nowOf(ctx);
  const org = ctx.orgId;
  const only = (col: AnyPgColumn, cond: SQL | undefined) => (opts.centerId ? and(cond, eq(col, opts.centerId)) : cond);
  const [cs, cps, ws, rs, hs, starts, backlog] = await Promise.all([
    db.select().from(centers).where(only(centers.id, eq(centers.organizationId, org))).orderBy(asc(centers.id)),
    db.select().from(centerPayers).where(only(centerPayers.centerId, eq(centerPayers.organizationId, org))),
    db.select().from(staffCapacityWindows).where(only(staffCapacityWindows.centerId, eq(staffCapacityWindows.organizationId, org))),
    db.select().from(capacityRules).where(only(capacityRules.centerId, eq(capacityRules.organizationId, org))),
    db
      .select()
      .from(capacityHolds)
      .where(
        only(
          capacityHolds.centerId,
          and(
            eq(capacityHolds.organizationId, org),
            ne(capacityHolds.status, "released"),
            gt(capacityHolds.expiresAt, now),
            opts.excludeHoldsForInquiry ? ne(capacityHolds.inquiryId, opts.excludeHoldsForInquiry) : undefined,
          ),
        ),
      ),
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
    onboardingBacklogByCenter(db, org),
  ]);
  const isEffective = (w: (typeof ws)[number]) =>
    (!w.effectiveFrom || w.effectiveFrom <= now) && (!w.effectiveTo || w.effectiveTo > now);
  return cs.map((c) =>
    toMatchCenter(c, {
      payers: cps.filter((p) => p.centerId === c.id),
      windows: ws.filter((w) => w.centerId === c.id && isEffective(w)),
      rules: rs.filter((r) => r.centerId === c.id),
      holds: hs.filter((h) => h.centerId === c.id),
      startsLast7Days: starts.find((x) => x.centerId === c.id)?.n ?? 0,
      onboardingBacklog: backlog.find((b) => b.centerId === c.id)?.n ?? 0,
    }),
  );
}

export type CapacityTimeline = {
  /** Centers as the matcher would have seen them at `t` (capacity version, holds and weekly starts as of t). */
  at(t: Date): MatchCenter[];
  /** True when every center has a capacity version in force at `t`. */
  covered(t: Date): boolean;
};

/**
 * As-of capacity (risk R8). Reconstructs, for any instant t, the capacity
 * version in force (windows + rules incl. their verification timestamps), the
 * holds that were active (created ≤ t < released/expiry) and verified starts in
 * the 7 days up to t. Not versioned: center profile (radius, modes, ages), payer
 * participation (current status; verification time capped at t) and the
 * onboarding backlog (score only, never eligibility).
 */
export async function loadCapacityTimeline(db: Executor, ctx: Ctx): Promise<CapacityTimeline> {
  const org = ctx.orgId;
  const [cs, cps, versions, vws, hs, starts, backlog] = await Promise.all([
    db.select().from(centers).where(eq(centers.organizationId, org)).orderBy(asc(centers.id)),
    db.select().from(centerPayers).where(eq(centerPayers.organizationId, org)),
    db.select().from(capacityVersions).where(eq(capacityVersions.organizationId, org)).orderBy(asc(capacityVersions.validFrom)),
    db.select().from(staffCapacityWindowVersions).where(eq(staffCapacityWindowVersions.organizationId, org)),
    db.select().from(capacityHolds).where(eq(capacityHolds.organizationId, org)),
    db
      .select({ centerId: inquiries.centerId, occurredAt: inquiryEvents.occurredAt })
      .from(inquiryEvents)
      .innerJoin(inquiries, and(eq(inquiries.id, inquiryEvents.inquiryId), eq(inquiries.organizationId, inquiryEvents.organizationId)))
      .where(and(eq(inquiryEvents.organizationId, org), eq(inquiryEvents.eventType, "care_started_verified_by_staff"))),
    onboardingBacklogByCenter(db, org),
  ]);
  const windowsByVersion = new Map<string, WindowLike[]>();
  for (const w of vws) {
    const list = windowsByVersion.get(w.capacityVersionId) ?? [];
    list.push(w);
    windowsByVersion.set(w.capacityVersionId, list);
  }
  const versionAt = (centerId: string, t: Date) =>
    versions.find((v) => v.centerId === centerId && v.validFrom <= t && (!v.validTo || t < v.validTo));
  return {
    covered: (t) => cs.every((c) => !!versionAt(c.id, t)),
    at: (t) =>
      cs.map((c) => {
        const v = versionAt(c.id, t);
        const weekAgo = t.getTime() - 7 * DAY;
        return toMatchCenter(c, {
          payers: cps.filter((p) => p.centerId === c.id),
          windows: v ? (windowsByVersion.get(v.id) ?? []) : [],
          rules: v ? ((v.rules as RuleLike[]) ?? []) : [],
          holds: hs.filter(
            (h) =>
              h.centerId === c.id &&
              h.createdAt <= t &&
              h.expiresAt > t &&
              (h.releasedAt ? h.releasedAt > t : h.status !== "released"),
          ),
          startsLast7Days: starts.filter((x) => x.centerId === c.id && x.occurredAt.getTime() > weekAgo && x.occurredAt <= t).length,
          onboardingBacklog: backlog.find((b) => b.centerId === c.id)?.n ?? 0,
          payerAsOf: t,
        });
      }),
  };
}

export type CapacityVersionInput = {
  centerId: string;
  version: number;
  validFrom: Date;
  attested: boolean;
  recordedBy: string | null;
  windows: WindowLike[];
  rules: (RuleLike & { minRbtCoverage?: number | null })[];
};

/** Append a capacity version: close the open one at validFrom, then insert the new header + window rows. */
export async function writeCapacityVersion(db: Executor, orgId: string, v: CapacityVersionInput) {
  await db
    .update(capacityVersions)
    .set({ validTo: v.validFrom })
    .where(and(eq(capacityVersions.organizationId, orgId), eq(capacityVersions.centerId, v.centerId), isNull(capacityVersions.validTo)));
  const [header] = await db
    .insert(capacityVersions)
    .values({
      organizationId: orgId,
      centerId: v.centerId,
      version: v.version,
      validFrom: v.validFrom,
      attested: v.attested,
      recordedBy: v.recordedBy,
      rules: v.rules.map((r) => ({
        payerId: r.payerId,
        requiredBcbaHoursPerDirectHour: r.requiredBcbaHoursPerDirectHour,
        minRbtCoverage: r.minRbtCoverage ?? null,
        maxNewStartsPerWeek: r.maxNewStartsPerWeek,
        isVerified: r.isVerified,
      })),
      createdAt: v.validFrom,
    })
    .returning({ id: capacityVersions.id });
  if (v.windows.length) {
    await db.insert(staffCapacityWindowVersions).values(
      v.windows.map((w) => ({
        organizationId: orgId,
        centerId: v.centerId,
        capacityVersionId: header!.id,
        role: w.role,
        dayOfWeek: w.dayOfWeek,
        startMinute: w.startMinute,
        endMinute: w.endMinute,
        weeklyAvailableHours: w.weeklyAvailableHours,
        serviceMode: w.serviceMode,
        verifiedAt: w.verifiedAt,
        createdAt: v.validFrom,
      })),
    );
  }
  return header!.id;
}

/** Capacity versions of a center, newest first (history panel / API). */
export async function listCapacityVersions(db: Executor, ctx: Ctx, centerId: string, limit = 20) {
  assertCan(ctx, "capacity:read");
  await getCenter(db, ctx, centerId);
  return db
    .select()
    .from(capacityVersions)
    .where(and(eq(capacityVersions.organizationId, ctx.orgId), eq(capacityVersions.centerId, centerId)))
    .orderBy(desc(capacityVersions.version))
    .limit(Math.min(limit, 100));
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
    await writeCapacityVersion(tx, ctx.orgId, {
      centerId,
      version: updated[0]!.version,
      validFrom: now,
      attested: data.attestVerified,
      recordedBy: ctx.userId,
      windows: data.windows.map((w) => ({ ...w, verifiedAt: data.attestVerified ? now : null })),
      rules: data.rules,
    });
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
