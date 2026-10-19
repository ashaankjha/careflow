import { assignVariant, DEFAULT_POLICY } from "@careflow/core";
import { ACS_URL_BASE, NPPES_LICENSE_NOTE, NPPES_SOURCE_URL } from "@careflow/connectors";
import { inArray, sql } from "drizzle-orm";
import { hashPassword } from "../auth";
import type { Db, Tx } from "../client";
import { seedUuid } from "../ids";
import * as s from "../schema";
import { hmacSalt } from "../services/experiments";
import { writeCapacityVersion } from "../services/capacity";
import { generateMissions } from "../services/missions";
import { marketZctas } from "../services/market";
import type { Ctx } from "../services/context";
import {
  CAPACITY_RULES,
  CAPACITY_WINDOWS,
  CENTERS,
  CENTER_PAYERS,
  DEMO_PASSWORD,
  HARBOR,
  LAKESIDE,
  PARTNERS,
  PAYERS,
  USERS,
  ZCTAS,
  centerId,
  partnerId,
  payerId,
  referralCodeId,
  toLatLng,
  userId,
} from "./fixtures";
import { simulateInquiries } from "./simulate";

const DAY = 86_400_000;

export function seedNow(): Date {
  const anchor = process.env.SEED_ANCHOR_DATE;
  if (anchor && /^\d{4}-\d{2}-\d{2}$/.test(anchor)) return new Date(`${anchor}T18:00:00Z`);
  const d = new Date();
  d.setUTCSeconds(0, 0);
  return d;
}

const DEMO_ORGS = [HARBOR.id, LAKESIDE.id];

/** Seeded capacity history: ops re-attests the (unchanged) sheet every 28 days. */
export const SEED_ATTESTATION_CYCLE_DAYS = 28;
/** Enough attestation cycles to cover the oldest seeded inquiry (90 days) for every site. */
const SEED_HISTORY_CYCLES = 5;

type SeedWindow = {
  role: "RBT" | "BCBA";
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  weeklyAvailableHours: number;
  serviceMode: string;
  /** null = never verified (pending ops verification in every version). */
  verified: boolean;
};

/**
 * Backfill capacity versions (risk R8) consistent with the live sheet: the
 * newest version starts at the most recent attestation (`lastAttestedDaysAgo`)
 * and carries the live verification timestamps; earlier versions repeat the same
 * values, each attested when it took effect. Returns the current version number.
 */
async function seedCapacityHistory(
  tx: Tx,
  orgId: string,
  cid: string,
  lastAttestedDaysAgo: number,
  windows: SeedWindow[],
  rules: { payerId: string | null; requiredBcbaHoursPerDirectHour: number | null; minRbtCoverage: number | null; maxNewStartsPerWeek: number | null; isVerified: boolean }[],
  ago: (days: number) => Date,
  recordedBy: string | null,
) {
  for (let v = 1; v <= SEED_HISTORY_CYCLES; v++) {
    const validFrom = ago(lastAttestedDaysAgo + (SEED_HISTORY_CYCLES - v) * SEED_ATTESTATION_CYCLE_DAYS);
    await writeCapacityVersion(tx, orgId, {
      centerId: cid,
      version: v,
      validFrom,
      attested: true,
      recordedBy,
      windows: windows.map((w) => ({ ...w, verifiedAt: w.verified ? validFrom : null })),
      rules,
    });
  }
  return SEED_HISTORY_CYCLES;
}

/** Delete all tenant data for the demo organisations (keeps orgs, users and sessions so admins stay signed in). */
async function purgeDemoData(tx: Tx) {
  await tx.execute(sql`set local careflow.allow_purge = 'on'`);
  const tables = [
    s.auditLogs,
    s.dailyMetrics,
    s.geoSignals,
    s.sourceSnapshots,
    s.experimentAssignments,
    s.experimentVariants,
    s.experiments,
    s.contentDrafts,
    s.missionEvidence,
    s.missions,
    s.capacityHolds,
    s.staffCapacityWindowVersions,
    s.capacityVersions,
    s.inquiryCenterMatches,
    s.inquiryEvents,
    s.inquiries,
    s.referralCodes,
    s.campaigns,
    s.referralPartners,
    s.capacityRules,
    s.staffCapacityWindows,
    s.centerPayers,
    s.payers,
    s.centers,
    s.consentRecords,
  ] as const;
  for (const t of tables) {
    await tx.delete(t).where(inArray(t.organizationId, DEMO_ORGS));
  }
}

export async function seedDatabase(db: Db, opts: { now?: Date } = {}) {
  const now = opts.now ?? seedNow();
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const sim = simulateInquiries(now);

  await db.transaction(async (tx) => {
    await purgeDemoData(tx);

    // Organisations & users (upsert: stable IDs keep sessions valid across resets)
    for (const org of [HARBOR, LAKESIDE]) {
      await tx
        .insert(s.organizations)
        .values({ id: org.id, name: org.name, timezone: org.timezone, demoMode: true, settings: DEFAULT_POLICY, seedAnchorAt: now })
        .onConflictDoUpdate({ target: s.organizations.id, set: { name: org.name, timezone: org.timezone, demoMode: true, settings: DEFAULT_POLICY, seedAnchorAt: now, updatedAt: now } });
    }
    for (const u of USERS) {
      const passwordHash = hashPassword(DEMO_PASSWORD, seedUuid(`salt:${u.key}`).replace(/-/g, ""));
      await tx
        .insert(s.users)
        .values({ id: userId(u.key), organizationId: u.org, authUserId: `local:${u.email}`, email: u.email, passwordHash, role: u.role, displayName: u.displayName })
        .onConflictDoUpdate({ target: s.users.id, set: { organizationId: u.org, role: u.role, displayName: u.displayName, passwordHash, email: u.email } });
    }

    // Payers & centers
    await tx.insert(s.payers).values(PAYERS.map((p) => ({ id: payerId(p.key), organizationId: HARBOR.id, name: p.name, category: p.category })));
    await tx.insert(s.centers).values(
      CENTERS.map((c) => {
        const ll = toLatLng(c.xy.x, c.xy.y);
        const windows = CAPACITY_WINDOWS[c.key]!;
        const verifiedDays = windows.map((w) => w.verifiedDaysAgo).filter((d): d is number => d !== null);
        return {
          id: centerId(c.key),
          organizationId: HARBOR.id,
          name: c.name,
          addressLine: c.addressLine,
          city: c.city,
          state: "DM",
          zip: c.zip,
          latitude: ll.lat,
          longitude: ll.lng,
          serviceModes: [...c.serviceModes],
          serviceRadiusMiles: c.radius,
          acceptedAgeMin: c.ageMin,
          acceptedAgeMax: c.ageMax,
          intakePhone: c.phone,
          intakeEmail: c.email,
          publicProfileStatus: c.publicProfileStatus,
          capacityVersion: SEED_HISTORY_CYCLES,
          capacityVerifiedAt: verifiedDays.length ? ago(Math.min(...verifiedDays)) : null,
          capacityVerifiedBy: userId("ops"),
          demoFixture: true,
        };
      }),
    );
    for (const c of CENTERS) {
      const cid = centerId(c.key);
      await tx.insert(s.centerPayers).values(
        Object.entries(CENTER_PAYERS[c.key]!).map(([pk, v]) => ({
          organizationId: HARBOR.id,
          centerId: cid,
          payerId: payerId(pk),
          status: v.status,
          lastVerifiedAt: v.verifiedDaysAgo === null ? null : ago(v.verifiedDaysAgo),
          verifiedBy: v.verifiedDaysAgo === null ? null : userId("ops"),
          notes: v.notes ?? null,
        })),
      );
      await tx.insert(s.staffCapacityWindows).values(
        CAPACITY_WINDOWS[c.key]!.flatMap((w) =>
          w.days.map((d, i) => ({
            organizationId: HARBOR.id,
            centerId: cid,
            role: w.role,
            dayOfWeek: d,
            startMinute: w.start,
            endMinute: w.end,
            weeklyAvailableHours: Array.isArray(w.hours) ? w.hours[i]! : w.hours,
            serviceMode: w.mode,
            verifiedAt: w.verifiedDaysAgo === null ? null : ago(w.verifiedDaysAgo),
            verifiedBy: w.verifiedDaysAgo === null ? null : userId("ops"),
            effectiveFrom: ago(60),
          })),
        ),
      );
      const rules = CAPACITY_RULES[c.key]!.map((r) => ({
        payerId: r.payer ? payerId(r.payer) : null,
        requiredBcbaHoursPerDirectHour: r.ratio,
        minRbtCoverage: r.minRbt,
        maxNewStartsPerWeek: r.maxNew,
        isVerified: r.verified,
      }));
      await tx.insert(s.capacityRules).values(rules.map((r) => ({ ...r, organizationId: HARBOR.id, centerId: cid })));
      const verifiedDays = CAPACITY_WINDOWS[c.key]!.map((w) => w.verifiedDaysAgo).filter((d): d is number => d !== null);
      await seedCapacityHistory(
        tx,
        HARBOR.id,
        cid,
        Math.min(...verifiedDays),
        CAPACITY_WINDOWS[c.key]!.flatMap((w) =>
          w.days.map((d, i) => ({
            role: w.role,
            dayOfWeek: d,
            startMinute: w.start,
            endMinute: w.end,
            weeklyAvailableHours: Array.isArray(w.hours) ? w.hours[i]! : w.hours,
            serviceMode: w.mode,
            verified: w.verifiedDaysAgo !== null,
          })),
        ),
        rules,
        ago,
        userId("ops"),
      );
    }

    // Referral partners & codes (public professional listings — fictional)
    await tx.insert(s.referralPartners).values(
      PARTNERS.map((p) => ({
        id: partnerId(p.key),
        organizationId: HARBOR.id,
        businessName: p.name,
        category: p.category,
        publicContactName: null,
        publicContactEmail: null,
        sourceUrl: `https://example.org/demo-directory/${p.key}`,
        location: `Harbor Bay (DEMO) · ZCTA ${p.zcta}`,
        zcta5: p.zcta,
        relationshipStatus: p.status,
        contactPermissionStatus: p.permission,
        lastReviewedAt: ago(30),
        demoFixture: true,
      })),
    );
    const coded = PARTNERS.filter((p) => p.code);
    await tx.insert(s.referralCodes).values(
      coded.map((p) => ({ id: referralCodeId(p.code!), organizationId: HARBOR.id, code: p.code!, partnerId: partnerId(p.key), status: p.status === "paused" ? "paused" : "active", validFrom: ago(120) })),
    );

    // Inquiries & immutable events
    for (let i = 0; i < sim.inquiries.length; i += 50) {
      await tx.insert(s.inquiries).values(
        sim.inquiries.slice(i, i + 50).map((q) => ({
          id: q.id,
          organizationId: HARBOR.id,
          syntheticDemo: true,
          stage: q.stage,
          stageEnteredAt: q.stageEnteredAt,
          contactAlias: q.contactAlias,
          serviceZip: q.serviceZip,
          payerId: q.payerId,
          preferredModes: q.preferredModes,
          preferredTimeWindows: q.windows,
          requestedDirectHours: q.requestedHours,
          intakeOwnerId: q.intakeOwnerId,
          sourceChannel: q.sourceChannel,
          sourceReferralCode: q.referralCode,
          referralCodeId: q.referralCodeId,
          centerId: centerId(q.centerKey),
          createdAt: q.createdAt,
          updatedAt: q.stageEnteredAt,
        })),
      );
    }
    for (let i = 0; i < sim.events.length; i += 200) {
      await tx.insert(s.inquiryEvents).values(
        sim.events.slice(i, i + 200).map((e) => ({
          id: e.id,
          organizationId: HARBOR.id,
          inquiryId: e.inquiryId,
          eventType: e.eventType,
          actorUserId: e.actorUserId,
          actorSource: "seed",
          previousStage: e.previousStage,
          nextStage: e.nextStage,
          occurredAt: e.occurredAt,
          recordedAt: e.occurredAt,
          metadata: e.metadata,
          schemaVersion: 1,
          idempotencyKey: e.idempotencyKey,
        })),
      );
    }

    // Proposed placement holds (MVP: proposed only, never reserved)
    const holdTargets: [string, number, number][] = [["north", 1, 3], ["south", 2, 4]];
    for (const [ck, n, hours] of holdTargets) {
      const cands = sim.inquiries.filter((q) => q.centerKey === ck && ["ready_to_start", "authorization_pending", "assessment_pending"].includes(q.stage)).slice(0, n);
      for (const q of cands) {
        await tx.insert(s.capacityHolds).values({
          id: seedUuid(`hold:${q.id}`),
          organizationId: HARBOR.id,
          inquiryId: q.id,
          centerId: centerId(ck),
          directWeeklyHoursEstimate: hours,
          bcbaWeeklyHoursEstimate: hours * 0.1,
          status: "proposed",
          expiresAt: new Date(now.getTime() + 14 * DAY),
          assignedBy: userId("ops"),
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Public-data provenance (synthetic fixtures, clearly labelled)
    const acsSnap = seedUuid("snapshot:acs_fixture");
    const nppesSnap = seedUuid("snapshot:nppes_fixture");
    await tx.insert(s.sourceSnapshots).values([
      {
        id: acsSnap,
        organizationId: HARBOR.id,
        sourceKey: "acs_fixture",
        url: ACS_URL_BASE,
        sourceTimestamp: ago(3),
        ingestedAt: ago(3),
        datasetVersion: "Synthetic values in ACS 2024 5-year B01001 shape",
        checksum: "fixture-v1",
        status: "fixture",
        licenseNote: "SYNTHETIC demo values. Real ACS estimates require CENSUS_API_KEY and real ZCTAs.",
        parsingWarnings: ["Synthetic — not Census estimates", "Fictional ZCTA-like codes 00101–00112"],
        demoFixture: true,
        rowCount: ZCTAS.length,
      },
      {
        id: nppesSnap,
        organizationId: HARBOR.id,
        sourceKey: "nppes_fixture",
        url: NPPES_SOURCE_URL,
        sourceTimestamp: ago(3),
        ingestedAt: ago(3),
        datasetVersion: "Synthetic prefiltered NPPES-shaped fixture",
        checksum: "fixture-v1",
        status: "fixture",
        licenseNote: NPPES_LICENSE_NOTE,
        parsingWarnings: ["Listing counts are synthetic", "One ZCTA has no listing data (missing component demo)"],
        demoFixture: true,
        rowCount: ZCTAS.filter((z) => z.listings !== null).length,
      },
    ]);
    await tx.insert(s.geoSignals).values(
      ZCTAS.map((z) => ({
        organizationId: HARBOR.id,
        zcta5: z.zcta,
        label: `${z.label} (DEMO)`,
        asOfYear: 2024,
        child014Est: z.children,
        child014Moe: z.moe,
        providerListingCount: z.listings,
        centroidLat: z.lat,
        centroidLng: z.lng,
        tileQ: z.q,
        tileR: z.r,
        demoFixture: true,
        sourceSnapshotId: acsSnap,
        listingSnapshotId: nppesSnap,
      })),
    );

    // Lakeside (second tenant used for isolation tests)
    const lc = seedUuid("center:lakeside:main");
    const lp = seedUuid("payer:lakeside:prairie");
    await tx.insert(s.payers).values({ id: lp, organizationId: LAKESIDE.id, name: "Prairie Health (DEMO)", category: "commercial" });
    await tx.insert(s.centers).values({
      id: lc,
      organizationId: LAKESIDE.id,
      name: "Lakeside Main Clinic (DEMO)",
      addressLine: "1 Demo Lane",
      city: "Lakeside (DEMO)",
      state: "DM",
      zip: "00201",
      latitude: 44.9,
      longitude: -88.0,
      serviceModes: ["center"],
      serviceRadiusMiles: 10,
      intakePhone: "555-0200 (demo)",
      intakeEmail: "intake@lakeside.demo",
      capacityVersion: SEED_HISTORY_CYCLES,
      capacityVerifiedAt: ago(3),
    });
    await tx.insert(s.centerPayers).values({ organizationId: LAKESIDE.id, centerId: lc, payerId: lp, status: "verified_accepted", lastVerifiedAt: ago(3) });
    const lakesideWindow = { role: "RBT" as const, dayOfWeek: 1, startMinute: 480, endMinute: 720, weeklyAvailableHours: 4, serviceMode: "center" };
    const lakesideRule = { payerId: null, requiredBcbaHoursPerDirectHour: 0.1, minRbtCoverage: null, maxNewStartsPerWeek: null, isVerified: true };
    await tx.insert(s.staffCapacityWindows).values({ organizationId: LAKESIDE.id, centerId: lc, ...lakesideWindow, verifiedAt: ago(3) });
    await tx.insert(s.capacityRules).values({ organizationId: LAKESIDE.id, centerId: lc, ...lakesideRule });
    await seedCapacityHistory(tx, LAKESIDE.id, lc, 3, [{ ...lakesideWindow, verified: true }], [lakesideRule], ago, null);
    for (let i = 0; i < 5; i++) {
      const id = seedUuid(`inquiry:lakeside:${i}`);
      const created = ago(10 + i);
      await tx.insert(s.inquiries).values({
        id,
        organizationId: LAKESIDE.id,
        contactAlias: `Demo Lakeside Family ${i}`,
        serviceZip: "00201",
        payerId: lp,
        preferredModes: ["center"],
        preferredTimeWindows: [{ dayOfWeek: 1, startMinute: 540, endMinute: 660 }],
        sourceChannel: "phone",
        centerId: lc,
        stage: "new",
        stageEnteredAt: created,
        createdAt: created,
      });
      await tx.insert(s.inquiryEvents).values({
        organizationId: LAKESIDE.id,
        inquiryId: id,
        eventType: "inquiry_created",
        actorSource: "seed",
        nextStage: "new",
        occurredAt: created,
        idempotencyKey: `seed:${id}:0`,
      });
    }
    await tx.insert(s.missions).values({
      id: seedUuid("mission:lakeside:1"),
      organizationId: LAKESIDE.id,
      centerId: lc,
      category: "Intake follow-up drag",
      ruleId: "M3",
      title: "Lakeside: close the first-response gap",
      explanation: "Synthetic second-tenant mission for isolation tests.",
      proposedAction: "Route a daily queue.",
      guardrail: "No automated messaging.",
      expectedDirection: "↑ response within SLA",
      impactScore: 3,
      effortScore: 2,
      confidenceScore: 0.5,
      priorityScore: 0.75,
      requiresOpsReview: false,
      dedupeKey: "lakeside-seed-m3",
    });
  });

  // Derived state built through the same services the app uses.
  const harborCtx: Ctx = { orgId: HARBOR.id, userId: userId("admin"), role: "admin", now, requestId: "seed" };
  const market = await marketZctas(db, harborCtx);
  await db.transaction(async (tx) => {
    for (const z of market.zctas) {
      await tx
        .update(s.geoSignals)
        .set({ internalInquiryCount: z.internalInquiries ?? 0, opportunityScore: z.opportunity.score, confidence: z.opportunity.confidence })
        .where(sql`${s.geoSignals.organizationId} = ${HARBOR.id} and ${s.geoSignals.zcta5} = ${z.zcta5}`);
    }
    await tx.insert(s.sourceSnapshots).values({
      id: seedUuid("snapshot:internal"),
      organizationId: HARBOR.id,
      sourceKey: "internal_inquiries",
      sourceTimestamp: now,
      ingestedAt: now,
      datasetVersion: "CareFlow event log",
      checksum: "seed",
      status: "ok",
      licenseNote: "First-party, tenant-scoped aggregate; small cells suppressed.",
      parsingWarnings: [],
      demoFixture: true,
      rowCount: market.zctas.length,
    });
  });
  const gen = await generateMissions(db, harborCtx);

  // Experiments: one observational (South), one partner-randomized (West) with persisted HMAC assignments.
  const obsId = seedUuid("experiment:south-benefits-checklist");
  const rndId = seedUuid("experiment:west-referral-sheet-format");
  await db.transaction(async (tx) => {
    const campObs = seedUuid("campaign:south-benefits");
    const campRnd = seedUuid("campaign:west-referral-sheet");
    await tx.insert(s.campaigns).values([
      { id: campObs, organizationId: HARBOR.id, name: "South benefits checklist pilot", type: "capacity_ops", centerId: centerId("south"), status: "active", ownerUserId: userId("ops"), createdAt: ago(30) },
      { id: campRnd, organizationId: HARBOR.id, name: "Referral info sheet format test", type: "referral", centerId: centerId("west"), status: "active", ownerUserId: userId("growth"), createdAt: ago(40) },
    ]);
    await tx.insert(s.experiments).values([
      {
        id: obsId,
        organizationId: HARBOR.id,
        campaignId: campObs,
        centerId: centerId("south"),
        name: "South benefits checklist pilot",
        hypothesis: "A structured benefits-verification checklist with named owners increases the share of South benefits requests verified within 10 days.",
        primaryMetric: "benefits_verified_within_threshold",
        guardrailMetrics: ["median_first_response_hours", "close_without_resolution_rate"],
        assignmentUnit: "none",
        designType: "observational",
        status: "active",
        baselineDays: 60,
        plannedDurationDays: 56,
        startedAt: ago(21),
        ownerUserId: userId("ops"),
        analysisNotes: "Descriptive before/after only. Staffing and payer mix changed during the window.",
        simulated: true,
        createdAt: ago(30),
      },
      {
        id: rndId,
        organizationId: HARBOR.id,
        campaignId: campRnd,
        centerId: centerId("west"),
        name: "Referral info sheet format (partner-randomized)",
        hypothesis: "A one-page factual referral sheet with a QR code increases referred inquiries that reach a verified start, versus the current letter-style sheet.",
        primaryMetric: "referred_inquiry_start_rate",
        guardrailMetrics: ["median_first_response_hours", "close_without_resolution_rate"],
        assignmentUnit: "partner",
        designType: "randomized",
        status: "active",
        baselineDays: 60,
        plannedDurationDays: 84,
        startedAt: ago(35),
        ownerUserId: userId("growth"),
        simulated: true,
        createdAt: ago(40),
      },
    ]);
    const control = { id: seedUuid("variant:rnd:control"), key: "control", allocationPct: 50 };
    const treatment = { id: seedUuid("variant:rnd:one_page"), key: "one_page", allocationPct: 50 };
    await tx.insert(s.experimentVariants).values([
      { ...control, organizationId: HARBOR.id, experimentId: rndId, description: "Current letter-style information sheet" },
      { ...treatment, organizationId: HARBOR.id, experimentId: rndId, description: "One-page factual sheet with QR attribution code" },
    ]);
    const units = PARTNERS.filter((p) => p.status === "active" && p.permission === "granted").map((p) => partnerId(p.key)).sort();
    await tx.insert(s.experimentAssignments).values(
      units.map((u) => {
        const { variant, unitHash } = assignVariant(hmacSalt(), rndId, u, [control, treatment]);
        return { organizationId: HARBOR.id, experimentId: rndId, unitHmac: unitHash, variantId: variant.id, unitRef: u, assignedAt: ago(35) };
      }),
    );
    await tx.insert(s.auditLogs).values({ organizationId: HARBOR.id, actorId: null, actorRole: "system", action: "demo.seed", entityType: "organization", entityId: HARBOR.id, allowed: true, details: { missions: gen.created.length, anchor: now.toISOString() } });
  });

  return {
    now: now.toISOString(),
    inquiries: sim.inquiries.length,
    events: sim.events.length,
    missions: gen.created.length,
  };
}

export const DEMO_ORG_IDS = DEMO_ORGS;
