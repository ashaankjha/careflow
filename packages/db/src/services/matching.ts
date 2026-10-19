import { evaluateMatch, matchRequestSchema, type MatchRequest, type MatchResult, type TimeWindow } from "@careflow/core";
import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { Db, Executor } from "../client";
import { geoSignals, inquiryCenterMatches, payers } from "../schema";
import { audit } from "./audit";
import { assertCan, nowOf, type Ctx } from "./context";
import { loadMatchCenters, type listCenters } from "./capacity";
import { getPolicy } from "./org";
import { getInquiryRow } from "./inquiries";

export async function zctaCentroid(db: Executor, ctx: Ctx, zip: string) {
  const [g] = await db
    .select({ lat: geoSignals.centroidLat, lng: geoSignals.centroidLng })
    .from(geoSignals)
    .where(and(eq(geoSignals.organizationId, ctx.orgId), eq(geoSignals.zcta5, zip)))
    .orderBy(desc(geoSignals.asOfYear))
    .limit(1);
  return g && g.lat != null && g.lng != null ? { lat: g.lat, lng: g.lng } : null;
}

/** Non-persistent deterministic evaluation (POST /matching/evaluate). */
export async function evaluateMatchRequest(db: Executor, ctx: Ctx, input: z.input<typeof matchRequestSchema>): Promise<MatchResult> {
  assertCan(ctx, "matching:evaluate");
  const req = matchRequestSchema.parse(input);
  return evaluateParsed(db, ctx, req);
}

export async function evaluateParsed(db: Executor, ctx: Ctx, req: MatchRequest, preloaded?: Awaited<ReturnType<typeof loadMatchCenters>>) {
  const [policy, centersData, zcta] = await Promise.all([
    getPolicy(db, ctx),
    preloaded ? Promise.resolve(preloaded) : loadMatchCenters(db, ctx),
    zctaCentroid(db, ctx, req.serviceZip),
  ]);
  let payerName: string | null = null;
  if (req.payerId) {
    const [p] = await db
      .select({ name: payers.name })
      .from(payers)
      .where(and(eq(payers.organizationId, ctx.orgId), eq(payers.id, req.payerId)));
    payerName = p?.name ?? null;
    if (!p) req = { ...req, payerId: null }; // foreign/unknown payer id is treated as missing, never trusted
  }
  return evaluateMatch(req, centersData, { now: nowOf(ctx), policy, zcta, payerName });
}

export function inquiryToMatchRequest(inq: {
  serviceZip: string;
  payerId: string | null;
  preferredModes: string[];
  preferredTimeWindows: unknown;
  requestedDirectHours: number | null;
}): MatchRequest {
  return matchRequestSchema.parse({
    serviceZip: inq.serviceZip,
    payerId: inq.payerId,
    preferredModes: inq.preferredModes,
    preferredWindows: (inq.preferredTimeWindows as TimeWindow[]) ?? [],
    requestedDirectHoursPerWeek: inq.requestedDirectHours,
  });
}

/** Persist a matching snapshot with explanations (POST /inquiries/:id/matches). */
export async function persistInquiryMatches(db: Db, ctx: Ctx, inquiryId: string) {
  assertCan(ctx, "matching:persist");
  const inq = await getInquiryRow(db, ctx, inquiryId);
  const result = await evaluateParsed(db, ctx, inquiryToMatchRequest(inq));
  const now = nowOf(ctx);
  await db.transaction(async (tx) => {
    await tx.insert(inquiryCenterMatches).values(
      result.matches.map((m) => ({
        organizationId: ctx.orgId,
        inquiryId,
        centerId: m.centerId,
        score: m.score,
        eligible: m.eligibility,
        reasons: m.gates,
        capacitySnapshotAt: m.capacityEvidenceAt ? new Date(m.capacityEvidenceAt) : null,
        generatedAt: now,
      })),
    );
    await audit(tx, ctx, "matching.persist", "inquiry", inquiryId, true, { status: result.status, candidates: result.matches.length });
  });
  return result;
}

export async function listInquiryMatchSnapshots(db: Executor, ctx: Ctx, inquiryId: string) {
  return db
    .select()
    .from(inquiryCenterMatches)
    .where(and(eq(inquiryCenterMatches.organizationId, ctx.orgId), eq(inquiryCenterMatches.inquiryId, inquiryId)))
    .orderBy(desc(inquiryCenterMatches.generatedAt))
    .limit(30);
}

export type CenterList = Awaited<ReturnType<typeof listCenters>>;
