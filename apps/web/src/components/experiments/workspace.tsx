"use client";
import { FlaskConical, Info, Plus, Shuffle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge, SyntheticBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { EmptyState, KeyValue } from "@/components/ui/misc";
import { api, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { fmtDate, fmtNum, fmtPct, titleCase } from "@/lib/format";

type Exp = {
  id: string; name: string; hypothesis: string; primaryMetric: string; guardrailMetrics: string[]; assignmentUnit: string; designType: string; status: string;
  startedAt: string | null; endedAt: string | null; baselineDays: number; plannedDurationDays: number; centerName: string | null; missionTitle: string | null; missionId: string | null;
  analysisNotes: string | null; simulated: boolean; variants: { id: string; key: string; description: string; allocationPct: number }[]; assignmentCount: number;
};
type Results = {
  randomized: boolean; verificationSource: string; dataVintage: string; simulated: boolean; unitLabel: string; successLabel: string; comparison: string; observationDays: number; typicalDaysToStart: number | null;
  analysis: { verdict: string; verdictLabel: string; arms: { key: string; label: string; units: number; denominator: number; successes: number; rate: number | null; interval: { low: number; high: number } | null }[]; difference: { absolute: number | null; relative: number | null; interval: { low: number; high: number } | null } | null; caveats: string[] };
  guardrails: { baseline: { inquiries: number; medianFirstResponseHours: number | null; closeWithoutResolution: number }; post: { inquiries: number; medianFirstResponseHours: number | null; closeWithoutResolution: number } };
};

function IntervalBar({ low, high, rate }: { low: number; high: number; rate: number }) {
  return (
    <div className="relative h-4 w-full" aria-hidden>
      <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
      <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-series-1/30" style={{ left: `${low * 100}%`, width: `${Math.max(0.5, (high - low) * 100)}%` }} />
      <div className="absolute top-1/2 h-3 w-1 -translate-y-1/2 rounded bg-series-1" style={{ left: `calc(${rate * 100}% - 2px)` }} />
    </div>
  );
}

export function ExperimentsWorkspace({ experiments, centers, canManage, initialId, tz }: { experiments: Exp[]; centers: { id: string; name: string }[]; canManage: boolean; initialId: string | null; tz: string }) {
  const router = useRouter();
  const [selId, setSelId] = useState<string | null>(initialId ?? experiments[0]?.id ?? null);
  const [res, setRes] = useState<Results | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const sel = experiments.find((e) => e.id === selId) ?? null;

  useEffect(() => {
    if (!selId) return;
    setRes(null);
    api<Results>(`/experiments/${selId}/results`).then(setRes).catch((e) => toast.error(e instanceof ApiError ? e.message : "Could not load results"));
  }, [selId, experiments]);

  async function act(key: string, path: string, ok: string) {
    setBusy(key);
    try {
      await api(path, { body: {} });
      toast.success(ok);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
      <div className="space-y-2">
        {canManage && <Button variant="primary" className="w-full justify-center" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New experiment</Button>}
        {experiments.map((e) => (
          <button key={e.id} onClick={() => setSelId(e.id)} className={cn("block w-full rounded-xl border bg-surface p-3 text-left shadow-card transition-colors", selId === e.id ? "border-accent ring-1 ring-accent" : "border-line hover:border-accent/40")} data-testid="experiment-item">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={e.status === "active" ? "teal" : e.status === "completed" ? "ink" : "neutral"}>{titleCase(e.status)}</Badge>
              <Badge tone={e.designType === "randomized" ? "blue" : "outline"}>{e.designType === "randomized" ? <><Shuffle className="h-3 w-3" />Randomized</> : titleCase(e.designType)}</Badge>
              {e.simulated && <SyntheticBadge label="Simulated" />}
            </div>
            <div className="mt-2 text-[13.5px] font-medium leading-5">{e.name}</div>
            <div className="mt-0.5 text-[12px] text-ink-3">{e.centerName} · {e.startedAt ? `started ${fmtDate(e.startedAt, tz)}` : "not started"}</div>
          </button>
        ))}
        {experiments.length === 0 && <EmptyState icon={<FlaskConical className="h-6 w-6" />} title="No experiments yet">Connect one from an approved mission.</EmptyState>}
      </div>

      {sel ? (
        <div className="space-y-4">
          <Card>
            <CardHeader
              eyebrow={sel.missionTitle ? `Mission: ${sel.missionTitle}` : "Standalone"}
              title={sel.name}
              description={sel.hypothesis}
              actions={canManage && (
                <>
                  {sel.status === "draft" && <Button variant="primary" size="sm" loading={busy === "start"} onClick={() => act("start", `/experiments/${sel.id}/start`, "Experiment started")}>Start</Button>}
                  {sel.status === "active" && <Button size="sm" loading={busy === "complete"} onClick={() => act("complete", `/experiments/${sel.id}/complete`, "Experiment completed")}>Mark complete</Button>}
                </>
              )}
            />
            <CardBody className="grid gap-x-8 sm:grid-cols-2">
              <div>
                <KeyValue k="Primary metric" v={<span className="font-mono text-[12px]">{sel.primaryMetric}</span>} />
                <KeyValue k="Guardrails" v={<span className="text-[12px]">{sel.guardrailMetrics.join(", ")}</span>} />
                <KeyValue k="Design" v={titleCase(sel.designType)} />
                <KeyValue k="Randomized flag" v={res ? (res.randomized ? <Badge tone="blue">Yes — {sel.assignmentCount} persisted HMAC assignments</Badge> : <Badge tone="neutral">No</Badge>) : "…"} />
              </div>
              <div>
                <KeyValue k="Assignment unit" v={titleCase(sel.assignmentUnit)} />
                <KeyValue k="Baseline window" v={`${sel.baselineDays} days`} />
                <KeyValue k="Planned duration" v={`${sel.plannedDurationDays} days`} />
                <KeyValue k="Run dates" v={`${fmtDate(sel.startedAt, tz)} → ${sel.endedAt ? fmtDate(sel.endedAt, tz) : "ongoing"}`} />
              </div>
              {sel.variants.length > 0 && (
                <div className="mt-3 sm:col-span-2">
                  <div className="eyebrow mb-1">Variants</div>
                  <div className="flex flex-wrap gap-2">{sel.variants.map((v) => <Badge key={v.id} tone="outline">{v.key}: {v.description} · {v.allocationPct}%</Badge>)}</div>
                </div>
              )}
            </CardBody>
          </Card>

          <Card data-testid="experiment-results">
            <CardHeader title="Results" description={res?.comparison} actions={res && <Badge tone={res.analysis.verdict === "estimate" ? "blue" : res.analysis.verdict === "insufficient_evidence" ? "warn" : "neutral"} data-testid="experiment-verdict">{res.analysis.verdictLabel}</Badge>} />
            <CardBody>
              {!res ? <p className="text-[13px] text-ink-3">Computing from the event log…</p> : (
                <div className="space-y-4">
                  <table className="w-full text-[12.5px]">
                    <thead><tr className="text-left text-[11px] uppercase tracking-wide text-ink-3"><th className="pb-2">Arm</th><th className="pb-2 text-right">Units</th><th className="pb-2 text-right">{res.successLabel} / {res.unitLabel}</th><th className="pb-2 text-right">Rate</th><th className="w-1/3 pb-2 pl-4">95% Wilson interval</th></tr></thead>
                    <tbody>
                      {res.analysis.arms.map((a) => (
                        <tr key={a.key} className="border-t border-line/70">
                          <td className="py-2 pr-2"><div className="font-medium">{a.key}</div><div className="text-[11.5px] text-ink-3">{a.label}</div></td>
                          <td className="py-2 text-right tabular">{a.units}</td>
                          <td className="py-2 text-right tabular">{a.successes} / {a.denominator}</td>
                          <td className="py-2 text-right font-semibold tabular">{fmtPct(a.rate, 1)}</td>
                          <td className="py-2 pl-4">{a.interval && a.rate != null ? <div><IntervalBar low={a.interval.low} high={a.interval.high} rate={a.rate} /><div className="text-[11px] text-ink-3 tabular">{fmtPct(a.interval.low, 1)} – {fmtPct(a.interval.high, 1)}</div></div> : <span className="text-ink-4">n/a</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {res.analysis.difference && (
                    <div className="rounded-lg bg-canvas p-3 text-[12.5px]">
                      <span className="font-medium">Difference ({res.analysis.arms[1]?.key} − {res.analysis.arms[0]?.key}):</span>{" "}
                      {res.analysis.difference.absolute == null ? "—" : `${(res.analysis.difference.absolute * 100).toFixed(1)} pts`}
                      {res.analysis.difference.relative != null && ` (${(res.analysis.difference.relative * 100).toFixed(0)}% relative)`}
                      {res.analysis.difference.interval ? ` · 95% CI ${(res.analysis.difference.interval.low * 100).toFixed(1)} to ${(res.analysis.difference.interval.high * 100).toFixed(1)} pts` : " · no interval reported (not eligible)"}
                      {res.analysis.verdict !== "estimate" && <span className="text-ink-3"> — descriptive, not a causal lift.</span>}
                    </div>
                  )}
                  <div>
                    <div className="eyebrow mb-1.5">Caveats</div>
                    <ul className="space-y-1 text-[12.5px] text-ink-2" data-testid="experiment-caveats">{res.analysis.caveats.map((c) => <li key={c} className="flex gap-1.5"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-4" />{c}</li>)}</ul>
                  </div>
                  <div>
                    <div className="eyebrow mb-1.5">Guardrails (site-level, baseline vs. since start)</div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="rounded-lg border border-line p-2.5 text-[12.5px]"><div className="text-ink-3">Inquiries</div><div className="font-semibold tabular">{res.guardrails.baseline.inquiries} → {res.guardrails.post.inquiries}</div></div>
                      <div className="rounded-lg border border-line p-2.5 text-[12.5px]"><div className="text-ink-3">Median hours to first contact</div><div className="font-semibold tabular">{fmtNum(res.guardrails.baseline.medianFirstResponseHours, 1)} → {fmtNum(res.guardrails.post.medianFirstResponseHours, 1)}</div></div>
                      <div className="rounded-lg border border-line p-2.5 text-[12.5px]"><div className="text-ink-3">Closed without resolution</div><div className="font-semibold tabular">{res.guardrails.baseline.closeWithoutResolution} → {res.guardrails.post.closeWithoutResolution}</div></div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-3 text-[11.5px] text-ink-3">
                    <span>verification_source: {res.verificationSource}</span>
                    <span>data vintage: {fmtDate(res.dataVintage, tz)}</span>
                    <span>observation: {res.observationDays} d (typical inquiry→start {res.typicalDaysToStart ? Math.round(res.typicalDaysToStart) : "—"} d)</span>
                    {res.simulated && <SyntheticBadge label="Simulated — not measured live" />}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      ) : (
        <EmptyState title="Select an experiment" />
      )}
      {creating && <CreateExperiment centers={centers} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setSelId(id); router.refresh(); }} />}
    </div>
  );
}

function CreateExperiment({ centers, onClose, onCreated }: { centers: { id: string; name: string }[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ centerId: centers[0]?.id ?? "", name: "", hypothesis: "", primaryMetric: "care_starts", designType: "observational", assignmentUnit: "none", baselineDays: 60, plannedDurationDays: 84 });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string | number) => setF({ ...f, [k]: v });
  async function submit() {
    setBusy(true);
    try {
      const e = await api<{ id: string }>("/experiments", {
        body: { ...f, guardrailMetrics: ["median_first_response_hours", "close_without_resolution_rate"], variants: f.designType === "randomized" ? [{ key: "control", description: "Current", allocationPct: 50 }, { key: "treatment", description: "New", allocationPct: 50 }] : [] },
      });
      toast.success("Experiment created as draft");
      onCreated(e.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Validation failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} wide title="New experiment" description="Defaults to observational. ‘None’ assignment cannot be randomized." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Create draft</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label>Site</Label><Select value={f.centerId} onChange={(e) => set("centerId", e.target.value)}>{centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
        <div><Label>Name</Label><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div className="sm:col-span-2"><Label>Hypothesis</Label><Textarea rows={3} value={f.hypothesis} onChange={(e) => set("hypothesis", e.target.value)} /></div>
        <div><Label>Primary metric</Label><Select value={f.primaryMetric} onChange={(e) => set("primaryMetric", e.target.value)}><option value="care_starts">care_starts</option><option value="response_within_sla_rate">response_within_sla_rate</option><option value="benefits_verified_within_threshold">benefits_verified_within_threshold</option></Select></div>
        <div><Label>Design</Label><Select value={f.designType} onChange={(e) => set("designType", e.target.value)}><option value="observational">Observational</option><option value="quasi_experimental">Quasi-experimental</option><option value="randomized">Randomized</option></Select></div>
        <div><Label>Assignment unit</Label><Select value={f.assignmentUnit} onChange={(e) => set("assignmentUnit", e.target.value)}><option value="none">None</option><option value="partner">Partner</option><option value="site_week">Site-week</option></Select></div>
        <div><Label>Baseline days</Label><Input type="number" value={f.baselineDays} onChange={(e) => set("baselineDays", Number(e.target.value))} /></div>
      </div>
    </Dialog>
  );
}
