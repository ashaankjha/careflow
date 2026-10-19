import {
  ACTIVE_STAGES,
  assertTransition,
  createInquirySchema,
  describeFinding,
  EVENT_SCHEMA_VERSION,
  eventTypeForTransition,
  isDemoAlias,
  outreachSchema,
  resolvePolicy,
  scanForSuspiciousPii,
  transitionSchema,
  TransitionError,
  validateCsv,
  type Stage,
} from "@careflow/core";
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import type { Db, Executor } from "../client";
import { centers, inquiries, inquiryEvents, organizations, payers, referralCodes, referralPartners, users } from "../schema";
import { audit } from "./audit";
import { AppError, assertCan, nowOf, type Ctx } from "./context";

export type InquiryFilters = {
  stage?: Stage | "active" | "stalled";
  centerId?: string;
  source?: string;
  ownerId?: string | "unassigned";
  q?: string;
  page?: number;
  pageSize?: number;
};

export async function getInquiryRow(db: Executor, ctx: Ctx, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("NOT_FOUND", "Inquiry not found");
  const [row] = await db
    .select()
    .from(inquiries)
    .where(and(eq(inquiries.organizationId, ctx.orgId), eq(inquiries.id, id)));
  if (!row) throw new AppError("NOT_FOUND", "Inquiry not found");
  return row;
}

export async function listInquiries(db: Executor, ctx: Ctx, f: InquiryFilters = {}) {
  assertCan(ctx, "inquiry:read");
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 50));
  const conds: SQL[] = [eq(inquiries.organizationId, ctx.orgId)];
  if (f.stage === "active") conds.push(inArray(inquiries.stage, [...ACTIVE_STAGES]));
  else if (f.stage && f.stage !== "stalled") conds.push(eq(inquiries.stage, f.stage));
  if (f.centerId) conds.push(eq(inquiries.centerId, f.centerId));
  if (f.source) conds.push(eq(inquiries.sourceChannel, f.source));
  if (f.ownerId === "unassigned") conds.push(sql`${inquiries.intakeOwnerId} is null`);
  else if (f.ownerId) conds.push(eq(inquiries.intakeOwnerId, f.ownerId));
  if (f.q) conds.push(or(ilike(inquiries.contactAlias, `%${f.q}%`), ilike(inquiries.serviceZip, `%${f.q}%`))!);

  const org = (await db.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, ctx.orgId)))[0];
  const policy = resolvePolicy(org?.settings);
  if (f.stage === "stalled") {
    const now = nowOf(ctx).getTime();
    const stallConds = ACTIVE_STAGES.map(
      (s) =>
        sql`(${inquiries.stage} = ${s} and ${inquiries.stageEnteredAt} < ${new Date(now - (policy.stallThresholdDays[s] ?? 7) * 86_400_000)})`,
    );
    conds.push(sql`(${sql.join(stallConds, sql` or `)})`);
  }
  const where = and(...conds);
  const [rows, [{ total } = { total: 0 }]] = await Promise.all([
    db
      .select({
        id: inquiries.id,
        contactAlias: inquiries.contactAlias,
        stage: inquiries.stage,
        stageEnteredAt: inquiries.stageEnteredAt,
        serviceZip: inquiries.serviceZip,
        sourceChannel: inquiries.sourceChannel,
        sourceReferralCode: inquiries.sourceReferralCode,
        createdAt: inquiries.createdAt,
        centerId: inquiries.centerId,
        centerName: centers.name,
        payerId: inquiries.payerId,
        payerName: payers.name,
        intakeOwnerId: inquiries.intakeOwnerId,
        ownerName: users.displayName,
        preferredModes: inquiries.preferredModes,
      })
      .from(inquiries)
      .leftJoin(centers, and(eq(centers.id, inquiries.centerId), eq(centers.organizationId, inquiries.organizationId)))
      .leftJoin(payers, and(eq(payers.id, inquiries.payerId), eq(payers.organizationId, inquiries.organizationId)))
      .leftJoin(users, and(eq(users.id, inquiries.intakeOwnerId), eq(users.organizationId, inquiries.organizationId)))
      .where(where)
      .orderBy(desc(inquiries.createdAt), asc(inquiries.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(inquiries).where(where),
  ]);
  const now = nowOf(ctx).getTime();
  return {
    items: rows.map((r) => {
      const ageDays = (now - r.stageEnteredAt.getTime()) / 86_400_000;
      const threshold = policy.stallThresholdDays[r.stage];
      return {
        ...r,
        daysInStage: Math.floor(ageDays),
        stalled: (ACTIVE_STAGES as readonly string[]).includes(r.stage) && threshold !== undefined && ageDays > threshold,
      };
    }),
    page,
    pageSize,
    total,
  };
}

export async function getInquiryDetail(db: Executor, ctx: Ctx, id: string) {
  assertCan(ctx, "inquiry:read");
  const row = await getInquiryRow(db, ctx, id);
  const [events, center, payer, partner] = await Promise.all([
    db
      .select({
        id: inquiryEvents.id,
        eventType: inquiryEvents.eventType,
        previousStage: inquiryEvents.previousStage,
        nextStage: inquiryEvents.nextStage,
        occurredAt: inquiryEvents.occurredAt,
        actorSource: inquiryEvents.actorSource,
        actorName: users.displayName,
        metadata: inquiryEvents.metadata,
      })
      .from(inquiryEvents)
      .leftJoin(users, and(eq(users.id, inquiryEvents.actorUserId), eq(users.organizationId, inquiryEvents.organizationId)))
      .where(and(eq(inquiryEvents.organizationId, ctx.orgId), eq(inquiryEvents.inquiryId, id)))
      .orderBy(asc(inquiryEvents.occurredAt), asc(inquiryEvents.recordedAt)),
    row.centerId
      ? db.select({ id: centers.id, name: centers.name }).from(centers).where(and(eq(centers.organizationId, ctx.orgId), eq(centers.id, row.centerId)))
      : Promise.resolve([]),
    row.payerId
      ? db.select({ id: payers.id, name: payers.name }).from(payers).where(and(eq(payers.organizationId, ctx.orgId), eq(payers.id, row.payerId)))
      : Promise.resolve([]),
    row.referralCodeId
      ? db
          .select({ code: referralCodes.code, partnerName: referralPartners.businessName })
          .from(referralCodes)
          .leftJoin(referralPartners, and(eq(referralPartners.id, referralCodes.partnerId), eq(referralPartners.organizationId, referralCodes.organizationId)))
          .where(and(eq(referralCodes.organizationId, ctx.orgId), eq(referralCodes.id, row.referralCodeId)))
      : Promise.resolve([]),
  ]);
  await audit(db, ctx, "inquiry.read", "inquiry", id, true);
  return { inquiry: row, events, center: center[0] ?? null, payer: payer[0] ?? null, referral: partner[0] ?? null };
}

async function resolveReferralCode(db: Executor, ctx: Ctx, code: string | null | undefined) {
  if (!code) return null;
  const [rc] = await db
    .select()
    .from(referralCodes)
    .where(and(eq(referralCodes.organizationId, ctx.orgId), eq(referralCodes.code, code.toUpperCase())));
  return rc ?? null;
}

/**
 * Demo-only inquiry creation. Idempotent on idempotencyKey: a retried request
 * returns the original inquiry and never writes a second inquiry_created event.
 */
export async function createInquiry(db: Db, ctx: Ctx, input: z.input<typeof createInquirySchema>, source: "user" | "import" = "user") {
  assertCan(ctx, "inquiry:create");
  const data = createInquirySchema.parse(input);
  const [org] = await db.select().from(organizations).where(eq(organizations.id, ctx.orgId));
  if (!org?.demoMode) throw new AppError("DEMO_ONLY", "Inquiry entry is only available in demo mode for the MVP");

  if (!isDemoAlias(data.contactAlias)) {
    throw new AppError("VALIDATION_FAILED", describeFinding({ field: "contactAlias", kind: "alias_format" }));
  }
  const findings = scanForSuspiciousPii({ contactAlias: data.contactAlias, referralCode: data.referralCode ?? null });
  if (findings.length) {
    await audit(db, ctx, "inquiry.create.rejected_pii", "inquiry", null, false, { kinds: findings.map((f) => f.kind) });
    throw new AppError("VALIDATION_FAILED", `Rejected: ${findings.map(describeFinding).join("; ")}. Demo accepts synthetic data only.`);
  }

  const idemKey = `create:${data.idempotencyKey}`;
  const existing = await db
    .select({ inquiryId: inquiryEvents.inquiryId })
    .from(inquiryEvents)
    .where(and(eq(inquiryEvents.organizationId, ctx.orgId), eq(inquiryEvents.idempotencyKey, idemKey)));
  if (existing[0]) return { inquiry: await getInquiryRow(db, ctx, existing[0].inquiryId), replayed: true };

  if (data.payerId) {
    const [p] = await db.select({ id: payers.id }).from(payers).where(and(eq(payers.organizationId, ctx.orgId), eq(payers.id, data.payerId)));
    if (!p) throw new AppError("NOT_FOUND", "Payer not found");
  }
  if (data.centerId) {
    const [c] = await db.select({ id: centers.id }).from(centers).where(and(eq(centers.organizationId, ctx.orgId), eq(centers.id, data.centerId)));
    if (!c) throw new AppError("NOT_FOUND", "Center not found");
  }
  const rc = await resolveReferralCode(db, ctx, data.referralCode);
  const now = nowOf(ctx);
  try {
    return await db.transaction(async (tx) => {
      const [inq] = await tx
        .insert(inquiries)
        .values({
          organizationId: ctx.orgId,
          syntheticDemo: true,
          stage: "new",
          stageEnteredAt: now,
          contactAlias: data.contactAlias,
          serviceZip: data.serviceZip,
          payerId: data.payerId ?? null,
          preferredModes: data.preferredModes,
          preferredTimeWindows: data.preferredWindows,
          requestedDirectHours: data.requestedDirectHoursPerWeek ?? null,
          sourceChannel: data.sourceChannel,
          sourceReferralCode: data.referralCode ? data.referralCode.toUpperCase() : null,
          referralCodeId: rc?.id ?? null,
          centerId: data.centerId ?? null,
          intakeOwnerId: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await tx.insert(inquiryEvents).values({
        organizationId: ctx.orgId,
        inquiryId: inq!.id,
        eventType: "inquiry_created",
        actorUserId: ctx.userId,
        actorSource: source,
        previousStage: null,
        nextStage: "new",
        occurredAt: now,
        metadata: {
          sourceChannel: data.sourceChannel,
          referralCode: rc?.code ?? null,
          referralCodeRecognized: !!rc || !data.referralCode,
          synthetic: true,
        },
        schemaVersion: EVENT_SCHEMA_VERSION,
        idempotencyKey: idemKey,
      });
      if (data.payerId) {
        await tx.insert(inquiryEvents).values({
          organizationId: ctx.orgId,
          inquiryId: inq!.id,
          eventType: "payer_info_recorded",
          actorUserId: ctx.userId,
          actorSource: source,
          occurredAt: now,
          metadata: { payerRecorded: true },
          schemaVersion: EVENT_SCHEMA_VERSION,
          idempotencyKey: `${idemKey}:payer`,
        });
      }
      await audit(tx, ctx, "inquiry.create", "inquiry", inq!.id, true, { source: data.sourceChannel });
      return { inquiry: inq!, replayed: false };
    });
  } catch (e) {
    // concurrent retry with the same key lost the race: return the winner
    if (isUniqueViolation(e)) {
      const again = await db
        .select({ inquiryId: inquiryEvents.inquiryId })
        .from(inquiryEvents)
        .where(and(eq(inquiryEvents.organizationId, ctx.orgId), eq(inquiryEvents.idempotencyKey, idemKey)));
      if (again[0]) return { inquiry: await getInquiryRow(db, ctx, again[0].inquiryId), replayed: true };
    }
    throw e;
  }
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

/** Validate the state machine and log an immutable event. Idempotent on eventIdempotencyKey. */
export async function transitionInquiry(db: Db, ctx: Ctx, inquiryId: string, input: z.input<typeof transitionSchema>) {
  assertCan(ctx, "inquiry:transition");
  const data = transitionSchema.parse(input);
  const idemKey = `transition:${data.eventIdempotencyKey}`;
  const prior = await db
    .select()
    .from(inquiryEvents)
    .where(and(eq(inquiryEvents.organizationId, ctx.orgId), eq(inquiryEvents.idempotencyKey, idemKey)));
  if (prior[0]) {
    if (prior[0].inquiryId !== inquiryId) throw new AppError("CONFLICT", "Idempotency key already used for another inquiry");
    return { inquiry: await getInquiryRow(db, ctx, inquiryId), replayed: true };
  }
  const now = nowOf(ctx);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(inquiries)
      .where(and(eq(inquiries.organizationId, ctx.orgId), eq(inquiries.id, inquiryId)))
      .for("update");
    if (!row) throw new AppError("NOT_FOUND", "Inquiry not found");
    const from = row.stage as Stage;
    try {
      assertTransition(from, data.toStage, data.reason);
    } catch (e) {
      if (e instanceof TransitionError) throw new AppError("INVALID_TRANSITION", e.message, { from, to: data.toStage });
      throw e;
    }
    let centerId = row.centerId;
    if (data.centerId) {
      const [c] = await tx.select({ id: centers.id }).from(centers).where(and(eq(centers.organizationId, ctx.orgId), eq(centers.id, data.centerId)));
      if (!c) throw new AppError("NOT_FOUND", "Center not found");
      centerId = c.id;
    }
    if (data.toStage === "started" && !centerId) {
      throw new AppError("VALIDATION_FAILED", "Select a site before recording a verified care start");
    }
    const eventType = eventTypeForTransition(from, data.toStage);
    await tx.insert(inquiryEvents).values({
      organizationId: ctx.orgId,
      inquiryId,
      eventType,
      actorUserId: ctx.userId,
      actorSource: "user",
      previousStage: from,
      nextStage: data.toStage,
      occurredAt: now,
      metadata: { reason: data.reason ?? null },
      schemaVersion: EVENT_SCHEMA_VERSION,
      idempotencyKey: idemKey,
    });
    const [updated] = await tx
      .update(inquiries)
      .set({ stage: data.toStage, stageEnteredAt: now, updatedAt: now, centerId, version: sql`${inquiries.version} + 1` })
      .where(and(eq(inquiries.organizationId, ctx.orgId), eq(inquiries.id, inquiryId)))
      .returning();
    await audit(tx, ctx, "inquiry.transition", "inquiry", inquiryId, true, { from, to: data.toStage, eventType });
    return { inquiry: updated!, replayed: false, eventType };
  });
}

export async function logOutreach(db: Db, ctx: Ctx, inquiryId: string, input: z.input<typeof outreachSchema>) {
  assertCan(ctx, "inquiry:transition");
  const data = outreachSchema.parse(input);
  await getInquiryRow(db, ctx, inquiryId);
  const idemKey = `outreach:${data.eventIdempotencyKey}`;
  const res = await db
    .insert(inquiryEvents)
    .values({
      organizationId: ctx.orgId,
      inquiryId,
      eventType: "outreach_attempted",
      actorUserId: ctx.userId,
      actorSource: "user",
      occurredAt: nowOf(ctx),
      metadata: { channel: "staff_logged" },
      schemaVersion: EVENT_SCHEMA_VERSION,
      idempotencyKey: idemKey,
    })
    .onConflictDoNothing()
    .returning({ id: inquiryEvents.id });
  if (res.length) await audit(db, ctx, "inquiry.outreach", "inquiry", inquiryId, true);
  return { recorded: res.length > 0 };
}

/** Select a target center for an inquiry (center_match_selected event; not an appointment). */
export async function selectCenter(db: Db, ctx: Ctx, inquiryId: string, centerId: string, idempotencyKey: string) {
  assertCan(ctx, "matching:persist");
  const [c] = await db.select({ id: centers.id, name: centers.name }).from(centers).where(and(eq(centers.organizationId, ctx.orgId), eq(centers.id, centerId)));
  if (!c) throw new AppError("NOT_FOUND", "Center not found");
  await getInquiryRow(db, ctx, inquiryId);
  const now = nowOf(ctx);
  return db.transaction(async (tx) => {
    const ins = await tx
      .insert(inquiryEvents)
      .values({
        organizationId: ctx.orgId,
        inquiryId,
        eventType: "center_match_selected",
        actorUserId: ctx.userId,
        actorSource: "user",
        occurredAt: now,
        metadata: { centerId, note: "Staff-selected target site; not an appointment" },
        schemaVersion: EVENT_SCHEMA_VERSION,
        idempotencyKey: `select:${idempotencyKey}`,
      })
      .onConflictDoNothing()
      .returning({ id: inquiryEvents.id });
    if (ins.length) {
      await tx.update(inquiries).set({ centerId, updatedAt: now }).where(and(eq(inquiries.organizationId, ctx.orgId), eq(inquiries.id, inquiryId)));
      await audit(tx, ctx, "inquiry.select_center", "inquiry", inquiryId, true, { centerId });
    }
    return { centerId, centerName: c.name };
  });
}

export async function assignOwner(db: Db, ctx: Ctx, inquiryId: string, ownerId: string | null) {
  assertCan(ctx, "inquiry:transition");
  await getInquiryRow(db, ctx, inquiryId);
  if (ownerId) {
    const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.organizationId, ctx.orgId), eq(users.id, ownerId)));
    if (!u) throw new AppError("NOT_FOUND", "User not found");
  }
  await db.update(inquiries).set({ intakeOwnerId: ownerId, updatedAt: nowOf(ctx) }).where(and(eq(inquiries.organizationId, ctx.orgId), eq(inquiries.id, inquiryId)));
  await audit(db, ctx, "inquiry.assign_owner", "inquiry", inquiryId, true, { ownerId });
  return { ownerId };
}

/** CSV preview/import. `commit=false` validates only. Never overwrites existing rows. */
export async function importInquiriesCsv(db: Db, ctx: Ctx, csvText: string, commit: boolean) {
  assertCan(ctx, "inquiry:import");
  if (csvText.length > 512_000) throw new AppError("VALIDATION_FAILED", "File too large for demo import (512 KB max)");
  const now = nowOf(ctx);
  const { rows, errors } = validateCsv(csvText, { now });
  const payerRows = await db.select().from(payers).where(eq(payers.organizationId, ctx.orgId));
  const byName = new Map(payerRows.map((p) => [p.name.toLowerCase(), p.id]));
  const rowErrors = [...errors];
  const prepared = rows.flatMap((r) => {
    let pid: string | null = null;
    if (r.payerName) {
      pid = byName.get(r.payerName.toLowerCase()) ?? null;
      if (!pid) {
        rowErrors.push({ line: r.line, column: "payer_name", message: `Unknown payer "${r.payerName}"` });
        return [];
      }
    }
    return [{ ...r, payerId: pid }];
  });
  const existing = prepared.length
    ? await db
        .select({ externalId: inquiries.externalId })
        .from(inquiries)
        .where(and(eq(inquiries.organizationId, ctx.orgId), eq(inquiries.importSource, "demo_csv"), inArray(inquiries.externalId, prepared.map((p) => p.externalId))))
    : [];
  const existingIds = new Set(existing.map((e) => e.externalId));
  const toInsert = prepared.filter((p) => !existingIds.has(p.externalId));
  const preview = {
    validRows: prepared.length,
    newRows: toInsert.length,
    duplicates: prepared.length - toInsert.length,
    errors: rowErrors.sort((a, b) => a.line - b.line),
    sample: toInsert.slice(0, 5).map((p) => ({ externalId: p.externalId, contactAlias: p.contactAlias, serviceZip: p.serviceZip, sourceChannel: p.sourceChannel })),
    committed: false,
    inserted: 0,
  };
  if (!commit || rowErrors.length) return preview;

  let inserted = 0;
  await db.transaction(async (tx) => {
    for (const r of toInsert) {
      const rc = await resolveReferralCode(tx, ctx, r.referralCode);
      const res = await tx
        .insert(inquiries)
        .values({
          organizationId: ctx.orgId,
          syntheticDemo: true,
          stage: "new",
          stageEnteredAt: r.createdAt,
          contactAlias: r.contactAlias,
          serviceZip: r.serviceZip,
          payerId: r.payerId,
          preferredModes: [r.preferredMode],
          preferredTimeWindows: r.window ? [r.window] : [],
          sourceChannel: r.sourceChannel,
          sourceReferralCode: r.referralCode?.toUpperCase() ?? null,
          referralCodeId: rc?.id ?? null,
          importSource: "demo_csv",
          externalId: r.externalId,
          createdAt: r.createdAt,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: inquiries.id });
      if (!res[0]) continue;
      inserted++;
      await tx.insert(inquiryEvents).values({
        organizationId: ctx.orgId,
        inquiryId: res[0].id,
        eventType: "inquiry_created",
        actorUserId: ctx.userId,
        actorSource: "import",
        nextStage: "new",
        occurredAt: r.createdAt,
        metadata: { sourceChannel: r.sourceChannel, referralCode: rc?.code ?? null, import: "demo_csv", synthetic: true },
        schemaVersion: EVENT_SCHEMA_VERSION,
        idempotencyKey: `import:demo_csv:${r.externalId}`,
      });
    }
    await audit(tx, ctx, "inquiry.import", "inquiry", null, true, { inserted, duplicates: preview.duplicates });
  });
  return { ...preview, committed: true, inserted };
}

export async function listIntakeOwners(db: Executor, ctx: Ctx) {
  return db
    .select({ id: users.id, displayName: users.displayName, role: users.role })
    .from(users)
    .where(and(eq(users.organizationId, ctx.orgId), inArray(users.role, ["intake", "admin"])))
    .orderBy(asc(users.displayName));
}

