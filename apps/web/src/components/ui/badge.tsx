import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type Tone = "neutral" | "blue" | "teal" | "good" | "warn" | "bad" | "ink" | "outline";
const tones: Record<Tone, string> = {
  neutral: "bg-ink/[0.06] text-ink-2",
  blue: "bg-accent-soft text-accent-ink",
  teal: "bg-teal-soft text-teal",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  ink: "bg-ink text-white",
  outline: "border border-line text-ink-2 bg-surface",
};

export function Badge({ tone = "neutral", className, ...p }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium leading-4", tones[tone], className)} {...p} />;
}

/** Labels synthetic / simulated data everywhere it appears (PRD: never present synthetic as live). */
export function SyntheticBadge({ label = "Synthetic", className }: { label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border border-dashed border-warn/50 bg-warn-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warn", className)}>
      {label}
    </span>
  );
}
