import { createAcsConnector, NPPES_LICENSE_NOTE, NPPES_LIMITATION, NPPES_SOURCE_URL, ACS_URL_BASE } from "@careflow/connectors";
import { computeOpportunityScores, haversineMiles, round } from "@careflow/core";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Db, Executor } from "../client";
import { centers, geoSignals, sourceSnapshots } from "../schema";
import { audit } from "./audit";
import { capacitySummaries } from "./capacity";
import { assertCan, nowOf, type Ctx } from "./context";
import { getPolicy } from "./org";

/** Verified hours that fully saturate the site-fit component. */
const SITE_FIT_SATURATION_HOURS = 20;

export async function listSources(db: Executor, ctx: Ctx) {
  assertCan(ctx, "sources:read");
  return db
    .select()
    .from(sourceSnapshots)
    .where(eq(sourceSnapshots.organizationId, ctx.orgId))
    .orderBy(desc(sourceSnapshots.ingestedAt))
    .limit(100);
}

/** GET /market/zctas — geo aggregation with live opportunity heuristic, confidence and provenance. */
export async function marketZctas(db: Executor, ctx: Ctx, opts: { bbox?: [number, number, number, number] | null } = {}) {
  assertCan(ctx, "market:read");
  const policy = await getPolicy(db, ctx);
  const [geo, cs, caps, inqCounts, sources] = await Promise.all([
    db.select().from(geoSignals).where(eq(geoSignals.organizationId, ctx.orgId)).orderBy(asc(geoSignals.zcta5)),
    db.select().from(centers).where(and(eq(centers.organizationId, ctx.orgId), eq(centers.active, true))),
    capacitySummaries(db, ctx),
    db.execute(sql`select service_zip, count(*)::int n from inquiries where organization_id = ${ctx.orgId} group by service_zip`) as unknown as Promise<{ service_zip: string; n: number }[]>,
    listSources(db, ctx),
  ]);
  const latest = new Map<string, (typeof geo)[number]>();
  for (const g of geo) if (!latest.has(g.zcta5) || latest.get(g.zcta5)!.asOfYear < g.asOfYear) latest.set(g.zcta5, g);
  let rowsG = [...latest.values()];
  if (opts.bbox) {
    const [minLng, minLat, maxLng, maxLat] = opts.bbox;
    rowsG = rowsG.filter((g) => g.centroidLat != null && g.centroidLng! >= minLng && g.centroidLng! <= maxLng && g.centroidLat! >= minLat && g.centroidLat! <= maxLat);
  }
  const enriched = rowsG.map((g) => {
    const covering =
      g.centroidLat == null
        ? []
        : cs
            .filter((c) => c.latitude != null)
            .map((c) => ({ c, d: haversineMiles({ lat: g.centroidLat!, lng: g.centroidLng! }, { lat: c.latitude!, lng: c.longitude! }) }))
            .filter((x) => x.d <= x.c.serviceRadiusMiles)
            .map((x) => ({ centerId: x.c.id, centerName: x.c.name, distanceMiles: round(x.d, 1), verifiedHours: caps.find((k) => k.centerId === x.c.id)?.hours ?? null }));
    const known = covering.filter((c) => c.verifiedHours !== null);
    const siteFit = g.centroidLat == null ? null : covering.length === 0 ? 0 : known.length === 0 ? null : Math.min(1, known.reduce((s, c) => s + c.verifiedHours!, 0) / SITE_FIT_SATURATION_HOURS);
    const rawCount = inqCounts.find((x) => x.service_zip === g.zcta5)?.n ?? 0;
    return { g, covering, siteFit, inquiryCount: Number(rawCount) };
  });
  const scores = computeOpportunityScores(
    enriched.map((e) => ({ zcta5: e.g.zcta5, children0to14: e.g.child014Est, providerListings: e.g.providerListingCount, siteFit: e.siteFit })),
    policy.minPopulationToRank,
  );
  const latestBy = (key: string) => sources.find((s) => s.sourceKey === key && s.status !== "failed" && s.status !== "skipped") ?? null;
  return {
    zctas: enriched.map((e, i) => {
      const s = scores[i]!;
      const suppressed = e.inquiryCount > 0 && e.inquiryCount < policy.minCellSize;
      return {
        zcta5: e.g.zcta5,
        label: e.g.label,
        asOfYear: e.g.asOfYear,
        demoFixture: e.g.demoFixture,
        centroid: e.g.centroidLat != null ? { lat: e.g.centroidLat, lng: e.g.centroidLng! } : null,
        tile: e.g.tileQ != null ? { q: e.g.tileQ, r: e.g.tileR! } : null,
        children0to14: e.g.child014Est,
        children0to14Moe: e.g.child014Moe,
        providerListings: e.g.providerListingCount,
        listingsPer1k: s.listingsPer1k,
        internalInquiries: suppressed ? null : e.inquiryCount,
        internalInquiriesSuppressed: suppressed,
        siteFit: e.siteFit === null ? null : round(e.siteFit, 2),
        coveringCenters: e.covering,
        opportunity: s,
      };
    }),
    method: {
      name: "Transparent outreach research heuristic",
      formula: "score = 100 × (0.45·P + 0.25·L + 0.30·F), re-normalised over available components",
      notes: [
        "Ranks outreach research locations — never individuals or families.",
        "Not a prevalence, diagnosis, or unmet-need estimate; no CDC prevalence multiplication.",
        "No protected demographic fields are used.",
        `ZCTAs with fewer than ${policy.minPopulationToRank} children are not ranked.`,
        `Internal inquiry counts below ${policy.minCellSize} are suppressed.`,
        NPPES_LIMITATION,
      ],
    },
    provenance: {
      acs: latestBy("census_acs_2024_b01001") ?? latestBy("acs_fixture"),
      listings: latestBy("nppes_fixture"),
      internal: latestBy("internal_inquiries"),
      recentRuns: sources.slice(0, 12),
    },
  };
}

/**
 * POST /market/refresh — admin-only manual refresh. Network/config failures are
 * recorded as auditable snapshots and never break the seeded demo.
 */
export async function refreshMarket(db: Db, ctx: Ctx, opts: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch } = {}) {
  assertCan(ctx, "market:refresh");
  const env = opts.env ?? process.env;
  const now = nowOf(ctx);
  const results: { sourceKey: string; status: string; message: string; rows: number }[] = [];

  // 1. Internal first-party aggregate (always available)
  const view = await marketZctas(db, ctx);
  await db.transaction(async (tx) => {
    await tx
      .insert(sourceSnapshots)
      .values({
        organizationId: ctx.orgId,
        sourceKey: "internal_inquiries",
        url: null,
        sourceTimestamp: now,
        ingestedAt: now,
        datasetVersion: "CareFlow event log",
        checksum: createHash("sha256").update(JSON.stringify(view.zctas.map((z) => [z.zcta5, z.internalInquiries]))).digest("hex").slice(0, 16),
        status: "ok",
        licenseNote: "First-party, tenant-scoped aggregate; small cells suppressed.",
        parsingWarnings: [],
        demoFixture: true,
        rowCount: view.zctas.length,
        triggeredBy: ctx.userId,
      });
    for (const z of view.zctas) {
      await tx
        .update(geoSignals)
        .set({
          internalInquiryCount: z.internalInquiries ?? 0,
          opportunityScore: z.opportunity.score,
          confidence: z.opportunity.confidence,
          updatedAt: now,
        })
        .where(and(eq(geoSignals.organizationId, ctx.orgId), eq(geoSignals.zcta5, z.zcta5), eq(geoSignals.asOfYear, z.asOfYear)));
    }
  });
  results.push({ sourceKey: "internal_inquiries", status: "ok", message: "Recomputed aggregates and opportunity scores", rows: view.zctas.length });

  // 2. ACS public refresh (optional)
  const zctas = (env.ACS_ZCTAS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const acs = createAcsConnector({ apiKey: env.CENSUS_API_KEY, zctas, fetchImpl: opts.fetchImpl, timeoutMs: 6000, retries: 1 });
  const cfg = acs.validateConfig();
  if (!cfg.ok) {
    await db.insert(sourceSnapshots).values({
      organizationId: ctx.orgId,
      sourceKey: "census_acs_2024_b01001",
      url: ACS_URL_BASE,
      ingestedAt: now,
      datasetVersion: "ACS 2024 5-year",
      status: "skipped",
      licenseNote: acs.licenseNote,
      parsingWarnings: [cfg.reason],
      demoFixture: false,
      rowCount: 0,
      triggeredBy: ctx.userId,
    });
    results.push({ sourceKey: "census_acs_2024_b01001", status: "skipped", message: cfg.reason, rows: 0 });
  } else {
    try {
      const raw = await acs.fetch();
      const { rows, warnings } = acs.normalize(raw);
      const fresh = acs.getFreshness();
      await db.transaction(async (tx) => {
        const [snap] = await tx
          .insert(sourceSnapshots)
          .values({
            organizationId: ctx.orgId,
            sourceKey: "census_acs_2024_b01001",
            url: ACS_URL_BASE,
            sourceTimestamp: fresh.sourceTimestamp ? new Date(fresh.sourceTimestamp) : now,
            ingestedAt: now,
            datasetVersion: fresh.datasetVersion,
            checksum: createHash("sha256").update(JSON.stringify(raw)).digest("hex").slice(0, 16),
            status: "ok",
            licenseNote: acs.licenseNote,
            parsingWarnings: [...warnings, ...rows.flatMap((r) => r.warnings.map((w) => `${r.zcta5}: ${w}`))],
            demoFixture: false,
            rowCount: rows.length,
            triggeredBy: ctx.userId,
          })
          .returning({ id: sourceSnapshots.id });
        for (const r of rows) {
          await tx
            .insert(geoSignals)
            .values({
              organizationId: ctx.orgId,
              zcta5: r.zcta5,
              label: `ZCTA ${r.zcta5} (public ACS)`,
              asOfYear: 2024,
              child014Est: r.child014Est,
              child014Moe: r.child014Moe,
              providerListingCount: null,
              demoFixture: false,
              sourceSnapshotId: snap!.id,
              confidence: "low",
            })
            .onConflictDoUpdate({
              target: [geoSignals.organizationId, geoSignals.zcta5, geoSignals.asOfYear],
              set: { child014Est: r.child014Est, sourceSnapshotId: snap!.id, updatedAt: now },
              setWhere: eq(geoSignals.demoFixture, false),
            });
        }
      });
      results.push({ sourceKey: "census_acs_2024_b01001", status: "ok", message: `Fetched ${rows.length} ZCTAs`, rows: rows.length });
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown error";
      await db.insert(sourceSnapshots).values({
        organizationId: ctx.orgId,
        sourceKey: "census_acs_2024_b01001",
        url: ACS_URL_BASE,
        ingestedAt: now,
        datasetVersion: "ACS 2024 5-year",
        status: "failed",
        licenseNote: acs.licenseNote,
        parsingWarnings: [`Fetch failed: ${message}. Synthetic fixture retained; demo unaffected.`],
        demoFixture: false,
        rowCount: 0,
        triggeredBy: ctx.userId,
      });
      results.push({ sourceKey: "census_acs_2024_b01001", status: "failed", message, rows: 0 });
    }
  }

  // 3. Listings fixture (live NPPES is Phase 2)
  await db.insert(sourceSnapshots).values({
    organizationId: ctx.orgId,
    sourceKey: "nppes_fixture",
    url: NPPES_SOURCE_URL,
    ingestedAt: now,
    datasetVersion: "Synthetic prefiltered NPPES-shaped fixture",
    status: "fixture",
    licenseNote: NPPES_LICENSE_NOTE,
    parsingWarnings: ["Live NPPES ingestion is Phase 2; fixture values are synthetic.", NPPES_LIMITATION],
    demoFixture: true,
    rowCount: view.zctas.filter((z) => z.providerListings !== null).length,
    triggeredBy: ctx.userId,
  });
  results.push({ sourceKey: "nppes_fixture", status: "fixture", message: "Synthetic listing fixture re-validated", rows: view.zctas.length });

  await audit(db, ctx, "market.refresh", "source_snapshot", null, true, { results: results.map((r) => ({ k: r.sourceKey, s: r.status })) });
  return { ranAt: now.toISOString(), results };
}
