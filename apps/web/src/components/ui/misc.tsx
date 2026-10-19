import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function EmptyState({ icon, title, children, action, className }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-6 py-10 text-center", className)}>
      {icon && <div className="mb-3 text-ink-4">{icon}</div>}
      <div className="text-sm font-medium text-ink">{title}</div>
      {children && <div className="mt-1 max-w-sm text-[13px] text-ink-3">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[13.5px] text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Meter({ value, tone = "blue", label }: { value: number | null; tone?: "blue" | "good" | "warn" | "bad"; label?: string }) {
  const color = { blue: "bg-series-1", good: "bg-good", warn: "bg-warn", bad: "bg-bad" }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/[0.07]" role="meter" aria-valuenow={value == null ? undefined : Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      {value != null && <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />}
    </div>
  );
}

export function KeyValue({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-[13px]">
      <span className="text-ink-3">{k}</span>
      <span className="text-right font-medium text-ink">{v}</span>
    </div>
  );
}
