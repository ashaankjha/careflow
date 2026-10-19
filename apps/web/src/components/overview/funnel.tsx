import { STAGE_LABELS, type Stage } from "@careflow/core/stages";
import { Tip } from "@/components/ui/tooltip";
import { fmtPct } from "@/lib/format";

export function Funnel({ data }: { data: { stage: string; reached: number; conversionToNext: number | null; nextStage: string | null }[] }) {
  const max = Math.max(1, ...data.map((d) => d.reached));
  return (
    <ol className="space-y-1.5" aria-label="Stage drop-off for the creation cohort">
      {data.map((d) => (
        <li key={d.stage} className="grid grid-cols-[130px_1fr_64px] items-center gap-3 text-[12.5px]">
          <span className="truncate text-ink-2">{STAGE_LABELS[d.stage as Stage]}</span>
          <Tip content={`${d.reached} inquiries in the cohort reached ${STAGE_LABELS[d.stage as Stage]}${d.conversionToNext != null ? ` · ${fmtPct(d.conversionToNext)} continued to ${STAGE_LABELS[d.nextStage as Stage]}` : ""}`}>
            <div className="relative h-6 cursor-default rounded bg-ink/[0.04]">
              <div className="absolute inset-y-0 left-0 rounded bg-series-1" style={{ width: `${(d.reached / max) * 100}%`, opacity: 0.35 + 0.65 * (d.reached / max) }} />
              <span className="absolute left-1.5 top-1/2 -translate-y-1/2 rounded bg-surface/90 px-1 font-medium leading-5 text-ink tabular">{d.reached}</span>
            </div>
          </Tip>
          <span className="text-right text-ink-3 tabular">{d.conversionToNext == null ? "" : `→ ${fmtPct(d.conversionToNext)}`}</span>
        </li>
      ))}
    </ol>
  );
}
