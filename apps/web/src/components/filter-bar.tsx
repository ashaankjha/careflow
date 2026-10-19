"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SOURCE_LABELS } from "@careflow/core/schemas";
import { Select } from "@/components/ui/field";
import { RANGE_OPTIONS } from "@/lib/filters";

export function FilterBar({ centers, showSource = true }: { centers: { id: string; name: string }[]; showSource?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    router.push(`${path}?${next.toString()}`);
  };
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
      <Select aria-label="Date range" className="w-40" value={sp.get("range") ?? "90"} onChange={(e) => set("range", e.target.value)}>
        {RANGE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </Select>
      <Select aria-label="Site" className="w-44" value={sp.get("centerId") ?? ""} onChange={(e) => set("centerId", e.target.value)}>
        <option value="">All sites</option>
        {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
      {showSource && (
        <Select aria-label="Source channel" className="w-48" value={sp.get("source") ?? ""} onChange={(e) => set("source", e.target.value)}>
          <option value="">All sources</option>
          {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      )}
    </div>
  );
}
