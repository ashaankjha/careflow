export const fmtPct = (v: number | null | undefined, digits = 0) => (v == null ? "—" : `${(v * 100).toFixed(digits)}%`);
export const fmtNum = (v: number | null | undefined, digits = 0) =>
  v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });

export function fmtDate(d: string | Date | null | undefined, tz = "America/Los_Angeles") {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: tz });
}

export function fmtDateTime(d: string | Date | null | undefined, tz = "America/Los_Angeles") {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz });
}

export function relativeDays(d: string | Date | null | undefined, now = Date.now()) {
  if (!d) return "never";
  const days = Math.floor((now - new Date(d).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
