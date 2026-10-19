export type Freshness = { sourceTimestamp: string | null; datasetVersion: string; stale: boolean; note: string };

export type NormalizedZctaRow = {
  zcta5: string;
  child014Est: number | null;
  child014Moe: number | null;
  providerListingCount?: number | null;
  warnings: string[];
};

/** PRD §14: pluggable read-only public data adapter. */
export interface PublicDataConnector<Raw = unknown> {
  key: string;
  licenseNote: string;
  validateConfig(): { ok: true } | { ok: false; reason: string };
  fetch(): Promise<Raw>;
  normalize(raw: Raw): { rows: NormalizedZctaRow[]; warnings: string[] };
  getFreshness(): Freshness;
}
