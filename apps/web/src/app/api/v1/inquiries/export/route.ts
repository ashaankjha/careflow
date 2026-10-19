import { audit, getDashboard } from "@careflow/db";
import { route, searchParams } from "@/lib/server/api";
import { db } from "@/lib/server/db";
import { parseDashboardFilters } from "@/lib/filters";

/** Aggregate-only CSV export (no aliases, ZIPs or per-inquiry rows). */
export const GET = route("inquiry:export_aggregate", async ({ ctx, req }) => {
  const f = parseDashboardFilters(Object.fromEntries(searchParams(req)));
  const d = await getDashboard(db(), ctx, f);
  const lines = ["section,key,numerator,denominator,value"];
  for (const [k, v] of Object.entries(d.kpis)) lines.push(`kpi,${k},${v.numerator ?? ""},${v.denominator ?? ""},${v.value ?? ""}`);
  for (const s of d.funnel) lines.push(`funnel,${s.stage},${s.reached},,${s.conversionToNext ?? ""}`);
  for (const s of d.siteMatrix) lines.push(`site,"${s.centerName}",${s.cohortStarted},${s.cohortSize},${s.verifiedHours ?? ""}`);
  for (const c of d.attribution.codes) lines.push(`attribution,${c.code},${c.starts},${c.inquiries},`);
  lines.push(`attribution,unattributed,${d.attribution.unattributed.starts},${d.attribution.unattributed.inquiries},`);
  await audit(db(), ctx, "export.aggregate_csv", "dashboard", null, true, { from: d.filters.from, to: d.filters.to });
  return new Response(lines.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=careflow-aggregate-metrics.csv" } });
});
