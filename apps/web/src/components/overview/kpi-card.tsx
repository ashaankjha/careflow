import { InfoTip } from "@/components/ui/tooltip";
import { METRIC_DEFS } from "@/lib/metric-defs";

export function KpiCard({ metric, value, sub, ratio, testId }: { metric: string; value: string; sub?: React.ReactNode; ratio?: string; testId?: string }) {
  const def = METRIC_DEFS[metric]!;
  return (
    <div className="flex flex-col rounded-xl border border-line bg-surface p-4 shadow-card" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium text-ink-3">{def.label}</span>
        <InfoTip
          label={`Definition of ${def.label}`}
          content={
            <div className="space-y-1.5">
              <div>{def.definition}</div>
              <div><span className="text-white/60">Numerator:</span> {def.numerator}</div>
              <div><span className="text-white/60">Denominator:</span> {def.denominator}</div>
              {def.caveat && <div className="text-white/70">{def.caveat}</div>}
            </div>
          }
        />
      </div>
      <div className="mt-2 text-[28px] font-semibold leading-none tracking-tight tabular" data-testid={testId ? `${testId}-value` : undefined}>{value}</div>
      {ratio && <div className="mt-2 font-mono text-[11.5px] text-ink-3 tabular" data-testid={testId ? `${testId}-ratio` : undefined}>{ratio}</div>}
      {sub && <div className="mt-1 text-[12px] text-ink-3">{sub}</div>}
    </div>
  );
}
