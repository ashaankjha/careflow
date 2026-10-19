const EARTH_RADIUS_MILES = 3958.8;

/** Great-circle distance. Labelled as an approximation everywhere it is shown (not drive time). */
export function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function round(n: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export type OpportunityInput = {
  zcta5: string;
  children0to14: number | null;
  providerListings: number | null;
  /** Verified operational fit for this organisation near the ZCTA, 0..1, or null if unknown. */
  siteFit: number | null;
};

export type OpportunityResult = {
  zcta5: string;
  ranked: boolean;
  score: number | null;
  scoreLow: number | null;
  scoreHigh: number | null;
  confidence: "high" | "medium" | "low" | "not_ranked";
  components: { population: number | null; listingGap: number | null; siteFit: number | null };
  listingsPer1k: number | null;
  warnings: string[];
};

const WEIGHTS = { population: 0.45, listingGap: 0.25, siteFit: 0.3 } as const;

/** Percentile rank in [0,1] with ties sharing the average rank (deterministic). */
export function percentileRanks(values: (number | null)[]): (number | null)[] {
  const present = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v !== null && Number.isFinite(x.v));
  const out: (number | null)[] = values.map(() => null);
  if (present.length === 0) return out;
  if (present.length === 1) {
    out[present[0]!.i] = 1;
    return out;
  }
  const sorted = [...present].sort((a, b) => a.v - b.v);
  for (const p of present) {
    const below = sorted.filter((s) => s.v < p.v).length;
    const equal = sorted.filter((s) => s.v === p.v).length;
    out[p.i] = (below + (equal - 1) / 2) / (sorted.length - 1);
  }
  return out;
}

/**
 * Transparent outreach-research heuristic (PRD §9). NOT a prevalence or need
 * estimate; ranks research locations, never individuals. Missing components
 * re-normalise remaining weights and widen the reported range.
 */
export function computeOpportunityScores(rows: OpportunityInput[], minPopulation: number): OpportunityResult[] {
  const eligible = rows.map((r) => (r.children0to14 ?? 0) >= minPopulation);
  const pop = percentileRanks(rows.map((r, i) => (eligible[i] ? r.children0to14 : null)));
  const per1k = rows.map((r) =>
    r.children0to14 && r.children0to14 > 0 && r.providerListings !== null
      ? (r.providerListings / r.children0to14) * 1000
      : null,
  );
  // inverse listings density: fewer listings per 1k children => higher gap percentile
  const gap = percentileRanks(per1k.map((v, i) => (eligible[i] && v !== null ? -v : null)));
  const fit = rows.map((r, i) => (eligible[i] ? r.siteFit : null));

  return rows.map((r, i) => {
    const warnings: string[] = [];
    if (!eligible[i]) {
      warnings.push(
        r.children0to14 === null
          ? "Child population estimate missing — not ranked"
          : `Population below minimum denominator (${minPopulation}) — not ranked`,
      );
      return {
        zcta5: r.zcta5,
        ranked: false,
        score: null,
        scoreLow: null,
        scoreHigh: null,
        confidence: "not_ranked",
        components: { population: null, listingGap: null, siteFit: null },
        listingsPer1k: per1k[i] ?? null,
        warnings,
      };
    }
    const comps = { population: pop[i] ?? null, listingGap: gap[i] ?? null, siteFit: fit[i] ?? null };
    let wSum = 0;
    let acc = 0;
    let missingWeight = 0;
    for (const k of Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]) {
      const v = comps[k];
      if (v === null) {
        missingWeight += WEIGHTS[k];
        warnings.push(`${k} component missing — weights re-normalised`);
      } else {
        wSum += WEIGHTS[k];
        acc += WEIGHTS[k] * v;
      }
    }
    if ((r.providerListings ?? 0) < 3 && r.providerListings !== null)
      warnings.push("Very few public listings — density is unstable");
    const score = wSum > 0 ? (100 * acc) / wSum : null;
    // range: missing components could have been anywhere in [0,1]
    const scoreLow = wSum > 0 ? 100 * acc : null;
    const scoreHigh = wSum > 0 ? 100 * (acc + missingWeight) : null;
    const confidence = missingWeight === 0 ? (warnings.length ? "medium" : "high") : "low";
    return {
      zcta5: r.zcta5,
      ranked: true,
      score: score === null ? null : round(score, 1),
      scoreLow: scoreLow === null ? null : round(scoreLow, 1),
      scoreHigh: scoreHigh === null ? null : round(scoreHigh, 1),
      confidence,
      components: comps,
      listingsPer1k: per1k[i] === null ? null : round(per1k[i]!, 2),
      warnings,
    };
  });
}
