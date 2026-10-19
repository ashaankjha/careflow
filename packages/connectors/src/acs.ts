import { fetchWithRetry } from "./fetch";
import type { Freshness, NormalizedZctaRow, PublicDataConnector } from "./public-data";

/** US Census ACS 2024 5-year, table B01001 (children aged 0–14 = 6 cells). */
export const ACS_VARIABLES = ["B01001_003E", "B01001_004E", "B01001_005E", "B01001_027E", "B01001_028E", "B01001_029E"] as const;
export const ACS_YEAR = 2024;
export const ACS_URL_BASE = `https://api.census.gov/data/${ACS_YEAR}/acs/acs5`;

export function acsUrl(key: string, zctas?: string[]): string {
  const geo = zctas?.length ? zctas.join(",") : "*";
  return `${ACS_URL_BASE}?get=NAME,${ACS_VARIABLES.join(",")}&for=zip%20code%20tabulation%20area:${geo}&key=${encodeURIComponent(key)}`;
}

/** Census uses large negative sentinels (e.g. -666666666) for suppressed / unavailable estimates. */
export function isSentinel(v: number): boolean {
  return !Number.isFinite(v) || v < 0;
}

export function normalizeAcs(raw: string[][]): { rows: NormalizedZctaRow[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!Array.isArray(raw) || raw.length < 1 || !Array.isArray(raw[0])) {
    return { rows: [], warnings: ["Unexpected ACS response shape"] };
  }
  const header = raw[0];
  const zIdx = header.indexOf("zip code tabulation area");
  const varIdx = ACS_VARIABLES.map((v) => header.indexOf(v));
  if (zIdx < 0 || varIdx.some((i) => i < 0)) return { rows: [], warnings: ["ACS response missing expected columns"] };
  const rows: NormalizedZctaRow[] = [];
  for (const r of raw.slice(1)) {
    const rowWarnings: string[] = [];
    const vals = varIdx.map((i) => Number(r[i]));
    const bad = vals.filter(isSentinel).length;
    let est: number | null = vals.filter((v) => !isSentinel(v)).reduce((s, v) => s + v, 0);
    if (bad === vals.length) {
      est = null;
      rowWarnings.push("All age cells suppressed/unavailable");
    } else if (bad > 0) {
      rowWarnings.push(`${bad} of 6 age cells suppressed — estimate is a lower bound`);
    }
    rows.push({ zcta5: String(r[zIdx]), child014Est: est, child014Moe: null, warnings: rowWarnings });
  }
  if (!rows.length) warnings.push("ACS returned no rows");
  warnings.push("ZCTAs approximate, and differ from, USPS delivery ZIP codes");
  return { rows, warnings };
}

export function createAcsConnector(opts: { apiKey?: string; zctas?: string[]; fetchImpl?: typeof fetch; timeoutMs?: number; retries?: number }) {
  let fetchedAt: string | null = null;
  const connector: PublicDataConnector<string[][]> = {
    key: "census_acs_2024_b01001",
    licenseNote: "U.S. Census Bureau ACS data are public domain. This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau.",
    validateConfig() {
      if (!opts.apiKey) return { ok: false, reason: "CENSUS_API_KEY not configured — synthetic fixture retained" };
      if (!opts.zctas?.length) return { ok: false, reason: "ACS_ZCTAS not configured — synthetic fixture retained" };
      if (opts.zctas.some((z) => !/^\d{5}$/.test(z))) return { ok: false, reason: "ACS_ZCTAS must be 5-digit codes" };
      return { ok: true };
    },
    async fetch() {
      const res = await fetchWithRetry(acsUrl(opts.apiKey!, opts.zctas), {
        fetchImpl: opts.fetchImpl,
        timeoutMs: opts.timeoutMs ?? 8000,
        retries: opts.retries ?? 2,
      });
      if (!res.ok) throw new Error(`ACS HTTP ${res.status}`);
      const json = (await res.json()) as string[][];
      fetchedAt = new Date().toISOString();
      return json;
    },
    normalize: normalizeAcs,
    getFreshness(): Freshness {
      return {
        sourceTimestamp: fetchedAt,
        datasetVersion: `ACS ${ACS_YEAR} 5-year (2020–2024)`,
        stale: false,
        note: "ACS 5-year estimates are period estimates with margins of error; refreshed annually.",
      };
    },
  };
  return connector;
}
