import type { MetricFilters } from "@careflow/db";

export const RANGE_OPTIONS = [
  { value: "30", label: "Last 30 days" },
  { value: "60", label: "Last 60 days" },
  { value: "90", label: "Last 90 days" },
] as const;

const UUID = /^[0-9a-f-]{36}$/i;

/** Shared dashboard filter parsing for the page and the API (identical semantics). */
export function parseDashboardFilters(p: Record<string, string | string[] | undefined>, now = new Date()): MetricFilters & { rangeDays: number } {
  const one = (k: string) => (Array.isArray(p[k]) ? p[k]![0] : (p[k] as string | undefined));
  let to = now;
  let from: Date;
  const fromStr = one("from");
  const toStr = one("to");
  let rangeDays = Number(one("range") ?? 90);
  if (![30, 60, 90].includes(rangeDays)) rangeDays = 90;
  if (fromStr && toStr && !Number.isNaN(Date.parse(fromStr)) && !Number.isNaN(Date.parse(toStr))) {
    from = new Date(fromStr);
    to = new Date(toStr);
    rangeDays = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  } else {
    from = new Date(now.getTime() - rangeDays * 86_400_000);
  }
  const centerId = one("centerId");
  const source = one("source");
  return { from, to, centerId: centerId && UUID.test(centerId) ? centerId : null, source: source && /^[a-z_]{2,40}$/.test(source) ? source : null, rangeDays };
}
