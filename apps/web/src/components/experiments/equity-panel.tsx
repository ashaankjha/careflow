"use client";
import { EyeOff, Info, Scale } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, SyntheticBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Label, Select } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";
import { fmtDate, fmtPct } from "@/lib/format";

type Cell = { numerator: number | null; denominator: number | null; rate: number | null; differenceVsOverall: number | null; suppressed: "primary" | "complementary" | null };
type Row = { key: string; label: string; inquiries: number | null; inquiriesSuppressed: "primary" | "complementary" | null; steps: Record<string, Cell> };
type Report = {
  notice: string; minCellSize: number; overall: Row; groups: Row[]; suppressedCells: number;
  steps: readonly { key: string; label: string; denominatorLabel: string }[];
  window: { from: string; to: string; days: number }; centerName: string | null; grouping: string; slaHours: number; cohortDefinition: string; caveats: string[];
};

function Suppressed({ kind }: { kind: "primary" | "complementary" }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-4" title={kind === "primary" ? "Suppressed: small cell" : "Suppressed so a small cell cannot be derived from totals"}>
      <EyeOff className="h-3 w-3" aria-hidden />
      {kind === "primary" ? "suppressed" : "suppressed (comp.)"}
    </span>
  );
}

function CellView({ c, overall }: { c: Cell; overall?: boolean }) {
  if (c.suppressed) return <Suppressed kind={c.suppressed} />;
  return (
    <div>
      <div className="font-semibold tabular">{fmtPct(c.rate, 1)}</div>
      <div className="text-[11px] text-ink-3 tabular">{c.numerator} / {c.denominator}</div>
      {!overall && c.differenceVsOverall != null && (
        <div className="text-[11px] text-ink-3 tabular">{c.differenceVsOverall >= 0 ? "+" : "−"}{Math.abs(c.differenceVsOverall * 100).toFixed(1)} pts vs all</div>
      )}
    </div>
  );
}

export function EquityPanel({ centers, tz }: { centers: { id: string; name: string }[]; tz: string }) {
  const [days, setDays] = useState("90");
  const [centerId, setCenterId] = useState("");
  const [rep, setRep] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRep(null);
    setErr(null);
    const qs = new URLSearchParams({ days, ...(centerId ? { centerId } : {}) });
    api<Report>(`/equity?${qs}`).then(setRep).catch((e) => setErr(e instanceof ApiError ? e.message : "Could not load the equity audit"));
  }, [days, centerId]);

  return (
    <Card data-testid="equity-panel">
      <CardHeader
        eyebrow={<span className="flex items-center gap-2"><Scale className="h-3.5 w-3.5" />Guardrail · aggregate only</span>}
        title="Equity audit: access rates by payer group"
        description="Descriptive comparison of how often inquiries in each payer group reach each access step. Differences are not causal and do not explain why groups differ."
        actions={<SyntheticBadge label="Synthetic" />}
      />
      <CardBody className="space-y-4">
        <div role="note" className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-[13px] font-semibold text-warn" data-testid="equity-notice">
          Equity audit only — never used for scoring, ranking, matching or exclusion.
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div><Label htmlFor="equity-days">Inquiry cohort</Label><Select id="equity-days" value={days} onChange={(e) => setDays(e.target.value)}><option value="30">Last 30 days</option><option value="60">Last 60 days</option><option value="90">Last 90 days</option><option value="180">Last 180 days</option></Select></div>
          <div><Label htmlFor="equity-site">Site</Label><Select id="equity-site" value={centerId} onChange={(e) => setCenterId(e.target.value)}><option value="">All sites</option>{centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
          {rep && <Badge tone="outline" data-testid="equity-min-cell">Small-cell threshold: {rep.minCellSize} · {rep.suppressedCells} cells suppressed</Badge>}
        </div>
        {err && <p className="text-[13px] text-bad">{err}</p>}
        {!rep && !err && <p className="text-[13px] text-ink-3">Aggregating from the event log…</p>}
        {rep && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[12.5px]" data-testid="equity-table">
                <caption className="sr-only">Access rates by payer group with small-cell suppression</caption>
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3">
                    <th scope="col" className="pb-2 pr-2">Payer group</th>
                    <th scope="col" className="pb-2 pr-2 text-right">Inquiries</th>
                    {rep.steps.map((s) => <th key={s.key} scope="col" className="pb-2 pl-3" title={`Denominator: ${s.denominatorLabel}`}>{s.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[rep.overall, ...rep.groups].map((r) => (
                    <tr key={r.key} className={r.key === "overall" ? "border-t border-line bg-canvas/60" : "border-t border-line/70"} data-testid={`equity-row-${r.key}`}>
                      <th scope="row" className="py-2 pr-2 text-left font-medium">{r.label}</th>
                      <td className="py-2 pr-2 text-right tabular">{r.inquiriesSuppressed ? <Suppressed kind={r.inquiriesSuppressed} /> : r.inquiries}</td>
                      {rep.steps.map((s) => <td key={s.key} className="py-2 pl-3 align-top">{r.steps[s.key] && <CellView c={r.steps[s.key]!} overall={r.key === "overall"} />}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <div className="eyebrow mb-1.5">How to read this</div>
              <ul className="space-y-1 text-[12.5px] text-ink-2" data-testid="equity-caveats">
                {[...rep.caveats, rep.cohortDefinition, `Grouping: ${rep.grouping}. SLA = ${rep.slaHours} h.`].map((c) => (
                  <li key={c} className="flex gap-1.5"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-4" />{c}</li>
                ))}
              </ul>
            </div>
            <div className="border-t border-line pt-3 text-[11.5px] text-ink-3">
              Window {fmtDate(rep.window.from, tz)} → {fmtDate(rep.window.to, tz)}{rep.centerName ? ` · ${rep.centerName}` : " · all sites"} · source: CareFlow event log (staff-recorded administrative events)
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
