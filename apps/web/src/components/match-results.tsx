"use client";
import type { MatchResult, CenterMatch, GateStatus } from "@careflow/core/matching";
import { CheckCircle2, CircleDashed, HelpCircle, MinusCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

const GATE_ICON: Record<GateStatus, { icon: typeof CheckCircle2; cls: string; label: string }> = {
  pass: { icon: CheckCircle2, cls: "text-good", label: "Pass" },
  fail: { icon: XCircle, cls: "text-bad", label: "Fail" },
  verification_needed: { icon: HelpCircle, cls: "text-warn", label: "Verification needed" },
  not_applicable: { icon: MinusCircle, cls: "text-ink-4", label: "Not applicable" },
};

export const ELIGIBILITY: Record<CenterMatch["eligibility"], { label: string; tone: "good" | "warn" | "bad" }> = {
  potential_fit: { label: "Potential fit", tone: "good" },
  verification_needed: { label: "Verification needed", tone: "warn" },
  not_feasible: { label: "Not feasible", tone: "bad" },
};

const STATUS_COPY: Record<MatchResult["status"], { label: string; cls: string }> = {
  potential_fit: { label: "Potential operational fit found", cls: "border-good/30 bg-good-soft text-good" },
  verification_needed: { label: "Verification needed before any fit can be asserted", cls: "border-warn/30 bg-warn-soft text-warn" },
  no_feasible_match: { label: "No feasible match — offer a human-reviewed alternate path", cls: "border-bad/30 bg-bad-soft text-bad" },
};

function ScoreBar({ label, value, weight }: { label: string; value: number; weight: number }) {
  return (
    <div className="grid grid-cols-[72px_1fr_38px] items-center gap-2 text-[11.5px]">
      <span className="text-ink-3">{label} <span className="text-ink-4">{Math.round(weight * 100)}%</span></span>
      <div className="h-1.5 rounded-full bg-ink/[0.07]"><div className="h-full rounded-full bg-series-1" style={{ width: `${value * 100}%` }} /></div>
      <span className="text-right tabular text-ink-2">{value.toFixed(2)}</span>
    </div>
  );
}

export function MatchResults({ result, onSelect, selectable, selectedCenterId }: { result: MatchResult; onSelect?: (centerId: string) => void; selectable?: boolean; selectedCenterId?: string | null }) {
  const s = STATUS_COPY[result.status];
  return (
    <div className="space-y-3" data-testid="match-results" data-status={result.status}>
      <div className={cn("rounded-lg border px-3 py-2 text-[13px] font-medium", s.cls)} data-testid="match-status">{s.label}</div>
      {result.matches.map((m, idx) => {
        const e = ELIGIBILITY[m.eligibility];
        return (
          <div key={m.centerId} className="rounded-lg border border-line bg-surface p-3" data-testid={`match-${m.centerName.split(" ")[0]!.toLowerCase()}`} data-eligibility={m.eligibility}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink/[0.06] text-[11px] font-semibold tabular">{idx + 1}</span>
                <span className="text-[13.5px] font-semibold">{m.centerName}</span>
                <Badge tone={e.tone}>{e.label}</Badge>
                {selectedCenterId === m.centerId && <Badge tone="ink">Selected site</Badge>}
              </div>
              <div className="flex items-center gap-3 text-[12px] text-ink-3">
                {m.distanceMiles != null && <Tip content="Great-circle approximation from the ZCTA centroid; travel time not evaluated."><span className="cursor-help underline decoration-dotted">~{m.distanceMiles} mi</span></Tip>}
                {m.score != null ? <span className="text-[15px] font-semibold text-ink tabular" data-testid="match-score">{m.score.toFixed(1)}</span> : <span className="text-ink-4">no score</span>}
              </div>
            </div>
            <ul className="mt-2.5 space-y-1">
              {m.gates.map((g) => {
                const G = GATE_ICON[g.status];
                return (
                  <li key={g.key} className="flex items-start gap-2 text-[12.5px]" data-gate={g.key} data-gate-status={g.status}>
                    <G.icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", G.cls)} aria-label={G.label} />
                    <span><span className="font-medium text-ink">{g.label}:</span> <span className="text-ink-2">{g.reason}</span></span>
                  </li>
                );
              })}
            </ul>
            {m.scoreComponents && (
              <div className="mt-3 space-y-1 border-t border-line pt-2">
                <ScoreBar label="Schedule" value={m.scoreComponents.schedule} weight={0.35} />
                <ScoreBar label="Capacity" value={m.scoreComponents.capacity} weight={0.25} />
                <ScoreBar label="Distance" value={m.scoreComponents.distance} weight={0.2} />
                <ScoreBar label="Backlog" value={m.scoreComponents.backlog} weight={0.2} />
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-3">
              <span className="flex items-center gap-1"><CircleDashed className="h-3 w-3" />Capacity evidence: {m.capacityEvidenceAt ? new Date(m.capacityEvidenceAt).toLocaleString() : "no verified windows"}</span>
              {selectable && m.eligibility !== "not_feasible" && onSelect && selectedCenterId !== m.centerId && (
                <button className="rounded-md border border-line px-2 py-1 text-[12px] font-medium text-ink hover:bg-canvas" onClick={() => onSelect(m.centerId)}>Select as target site</button>
              )}
            </div>
          </div>
        );
      })}
      {result.requiredStaffActions.length > 0 && (
        <div className="rounded-lg border border-line bg-canvas/60 p-3">
          <div className="eyebrow mb-1.5">Required staff actions</div>
          <ul className="list-disc space-y-0.5 pl-4 text-[12.5px] text-ink-2">{result.requiredStaffActions.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      )}
      <p className="text-[11.5px] leading-5 text-ink-3">{result.disclaimer} No bookable time slots are shown.</p>
    </div>
  );
}
