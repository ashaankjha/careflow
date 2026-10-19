"use client";
import { DAY_LABELS, SERVICE_MODE_LABELS, type ServiceMode } from "@careflow/core/schemas";
import { Input, Label, Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";

export type RequestState = {
  serviceZip: string;
  payerId: string;
  modes: ServiceMode[];
  days: number[];
  start: string;
  end: string;
  hours: string;
};

export const toMinutes = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export function requestToPayload(r: RequestState) {
  return {
    serviceZip: r.serviceZip,
    payerId: r.payerId || null,
    preferredModes: r.modes,
    preferredWindows: r.days.map((d) => ({ dayOfWeek: d, startMinute: toMinutes(r.start), endMinute: toMinutes(r.end) })),
    requestedDirectHoursPerWeek: r.hours ? Number(r.hours) : null,
  };
}

/** Shared synthetic request inputs (no diagnosis, DOB or clinical fields by design). */
export function RequestFields({ value, onChange, payers, zctas, idPrefix }: { value: RequestState; onChange: (v: RequestState) => void; payers: { id: string; name: string }[]; zctas: { zcta5: string; label: string }[]; idPrefix: string }) {
  const set = <K extends keyof RequestState>(k: K, v: RequestState[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor={`${idPrefix}-zip`}>Service ZCTA (study area)</Label>
        <Select id={`${idPrefix}-zip`} value={value.serviceZip} onChange={(e) => set("serviceZip", e.target.value)}>
          {zctas.map((z) => <option key={z.zcta5} value={z.zcta5}>{z.zcta5} · {z.label}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-payer`}>Payer (as reported)</Label>
        <Select id={`${idPrefix}-payer`} value={value.payerId} onChange={(e) => set("payerId", e.target.value)}>
          <option value="">Not recorded</option>
          {payers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-[12px] font-medium text-ink-2">Preferred service modes</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(SERVICE_MODE_LABELS) as ServiceMode[]).map((m) => {
            const on = value.modes.includes(m);
            return (
              <label key={m} className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12.5px]", on ? "border-accent bg-accent-soft text-accent-ink" : "border-line bg-surface text-ink-2")}>
                <input type="checkbox" className="accent-[#1F5FBF]" checked={on} onChange={() => set("modes", on ? value.modes.filter((x) => x !== m) : [...value.modes, m])} />
                {SERVICE_MODE_LABELS[m]}
              </label>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-[12px] font-medium text-ink-2">Preferred days</legend>
        <div className="flex flex-wrap gap-1.5">
          {DAY_LABELS.map((d, i) => {
            const on = value.days.includes(i);
            return (
              <button type="button" key={d} aria-pressed={on} onClick={() => set("days", on ? value.days.filter((x) => x !== i) : [...value.days, i].sort())} className={cn("h-8 w-11 rounded-md border text-[12.5px] font-medium", on ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2 hover:bg-canvas")}>
                {d}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <div><Label htmlFor={`${idPrefix}-start`}>From</Label><Input id={`${idPrefix}-start`} type="time" step={900} value={value.start} onChange={(e) => set("start", e.target.value)} /></div>
        <div><Label htmlFor={`${idPrefix}-end`}>To</Label><Input id={`${idPrefix}-end`} type="time" step={900} value={value.end} onChange={(e) => set("end", e.target.value)} /></div>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-hours`}>Requested direct hours / week</Label>
        <Input id={`${idPrefix}-hours`} type="number" min={1} max={40} placeholder="Planning default if blank" value={value.hours} onChange={(e) => set("hours", e.target.value)} />
      </div>
    </div>
  );
}
