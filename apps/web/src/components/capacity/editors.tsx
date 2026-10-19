"use client";
import { DAY_LABELS, SERVICE_MODE_LABELS, type ServiceMode } from "@careflow/core/schemas";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";

export type Sheet = {
  center: { id: string; name: string; addressLine: string; city: string; serviceModes: string[]; serviceRadiusMiles: number; acceptedAgeMin: number | null; acceptedAgeMax: number | null; capacityVerifiedAt: string | null };
  version: number;
  windows: { id: string; role: "RBT" | "BCBA"; dayOfWeek: number; startMinute: number; endMinute: number; weeklyAvailableHours: number; serviceMode: string; verifiedAt: string | null }[];
  rules: { id: string; payerId: string | null; requiredBcbaHoursPerDirectHour: number | null; minRbtCoverage: number | null; maxNewStartsPerWeek: number | null; isVerified: boolean }[];
  holds: { id: string; directWeeklyHoursEstimate: number; status: string }[];
  payers: { payerId: string; payerName: string; status: "verified_accepted" | "not_accepted" | "unknown"; lastVerifiedAt: string | null; notes: string | null }[];
  summary?: { hours: number | null; pendingHours: number; reason: string };
};

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export function CapacityEditor({ sheet, payers, onClose, onSaved }: { sheet: Sheet; payers: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState(sheet.windows.map((w) => ({ ...w, start: hm(w.startMinute), end: hm(w.endMinute) })));
  const [rules, setRules] = useState(sheet.rules.map((r) => ({ ...r })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modes = sheet.center.serviceModes as ServiceMode[];
  const update = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const key = sheet.center.name.split(" ")[0]!.toLowerCase();

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/centers/${sheet.center.id}/capacity`, {
        method: "PUT",
        body: {
          version: sheet.version,
          attestVerified: true,
          windows: rows.map((r) => ({ role: r.role, dayOfWeek: Number(r.dayOfWeek), startMinute: toMin(r.start), endMinute: toMin(r.end), weeklyAvailableHours: Number(r.weeklyAvailableHours), serviceMode: r.serviceMode })),
          rules: rules.map((r) => ({ payerId: r.payerId, requiredBcbaHoursPerDirectHour: r.requiredBcbaHoursPerDirectHour, minRbtCoverage: r.minRbtCoverage, maxNewStartsPerWeek: r.maxNewStartsPerWeek, isVerified: r.isVerified })),
        },
      });
      toast.success(`${sheet.center.name} capacity saved and attested as verified`);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      wide
      title={`Edit capacity · ${sheet.center.name}`}
      description="Aggregated weekly UNBOOKED staff hours per window. Saving attests the whole sheet as verified now (optimistic locking prevents overwriting a concurrent edit)."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save} data-testid="save-capacity">Save & attest verified</Button>
        </>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-[12.5px]" data-testid={`capacity-editor-${key}`}>
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-ink-3"><th className="pb-2">Role</th><th className="pb-2">Day</th><th className="pb-2">Start</th><th className="pb-2">End</th><th className="pb-2">Mode</th><th className="pb-2">Avail. h/wk</th><th className="pb-2">Status</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line/70" data-testid="capacity-row">
                <td className="py-1.5 pr-2"><Select aria-label="Role" className="h-8 w-20" value={r.role} onChange={(e) => update(i, { role: e.target.value as "RBT" | "BCBA" })}><option>RBT</option><option>BCBA</option></Select></td>
                <td className="py-1.5 pr-2"><Select aria-label="Day" className="h-8 w-20" value={r.dayOfWeek} onChange={(e) => update(i, { dayOfWeek: Number(e.target.value) })}>{DAY_LABELS.map((d, j) => <option key={d} value={j}>{d}</option>)}</Select></td>
                <td className="py-1.5 pr-2"><Input aria-label="Start" type="time" step={900} className="h-8 w-28" value={r.start} onChange={(e) => update(i, { start: e.target.value })} /></td>
                <td className="py-1.5 pr-2"><Input aria-label="End" type="time" step={900} className="h-8 w-28" value={r.end} onChange={(e) => update(i, { end: e.target.value })} /></td>
                <td className="py-1.5 pr-2"><Select aria-label="Mode" className="h-8 w-32" value={r.serviceMode} onChange={(e) => update(i, { serviceMode: e.target.value })}>{modes.map((m) => <option key={m} value={m}>{SERVICE_MODE_LABELS[m]}</option>)}</Select></td>
                <td className="py-1.5 pr-2"><Input aria-label="Available hours" type="number" min={0} step={0.5} className="h-8 w-20" value={r.weeklyAvailableHours} onChange={(e) => update(i, { weeklyAvailableHours: Number(e.target.value) })} data-testid={`hours-${r.role}-${r.dayOfWeek}-${r.startMinute}`} /></td>
                <td className="py-1.5 pr-2 text-[11.5px]">{r.verifiedAt ? <span className="text-good">verified</span> : <span className="text-warn">pending</span>}</td>
                <td className="py-1.5"><Button size="icon" variant="ghost" aria-label="Remove window" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button size="sm" variant="ghost" className="mt-2" onClick={() => setRows((x) => [...x, { id: `new-${x.length}`, role: "RBT", dayOfWeek: 1, startMinute: 780, endMinute: 1080, start: "13:00", end: "18:00", weeklyAvailableHours: 2, serviceMode: modes[0]!, verifiedAt: null }])}>
        <Plus className="h-3.5 w-3.5" />Add window
      </Button>

      <div className="mt-5 border-t border-line pt-4">
        <div className="eyebrow mb-2">Organization-validated staffing rules</div>
        {rules.map((r, i) => (
          <div key={i} className="mb-2 grid grid-cols-2 gap-2 rounded-lg border border-line p-3 sm:grid-cols-4">
            <div className="col-span-2 sm:col-span-1">
              <Label htmlFor={`rule-${i}-payer`}>Applies to</Label>
              <Select id={`rule-${i}-payer`} value={r.payerId ?? ""} onChange={(e) => setRules((x) => x.map((y, j) => (j === i ? { ...y, payerId: e.target.value || null } : y)))}>
                <option value="">All payers (site default)</option>
                {payers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </div>
            <div><Label htmlFor={`rule-${i}-bcba`}>BCBA h per direct h</Label><Input id={`rule-${i}-bcba`} type="number" step={0.025} min={0} max={1} value={r.requiredBcbaHoursPerDirectHour ?? ""} onChange={(e) => setRules((x) => x.map((y, j) => (j === i ? { ...y, requiredBcbaHoursPerDirectHour: e.target.value === "" ? null : Number(e.target.value) } : y)))} /></div>
            <div><Label htmlFor={`rule-${i}-max`}>Max new starts / wk</Label><Input id={`rule-${i}-max`} type="number" min={0} value={r.maxNewStartsPerWeek ?? ""} onChange={(e) => setRules((x) => x.map((y, j) => (j === i ? { ...y, maxNewStartsPerWeek: e.target.value === "" ? null : Number(e.target.value) } : y)))} /></div>
            <label className="flex items-end gap-2 pb-2 text-[12.5px]"><input type="checkbox" className="accent-[#1F5FBF]" checked={r.isVerified} onChange={(e) => setRules((x) => x.map((y, j) => (j === i ? { ...y, isVerified: e.target.checked } : y)))} />Rule verified</label>
          </div>
        ))}
      </div>
      {error && <p role="alert" className="mt-3 rounded-md bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</p>}
    </Dialog>
  );
}

export function PayerEditor({ sheet, onClose, onSaved }: { sheet: Sheet; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState(sheet.payers.map((p) => ({ ...p })));
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api(`/centers/${sheet.center.id}/payers`, { method: "PUT", body: { payers: rows.map((r) => ({ payerId: r.payerId, status: r.status, notes: r.notes })) } });
      toast.success("Payer participation updated (verified now by you)");
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Payer participation · ${sheet.center.name}`}
      description="Record what staff verified with each payer. A directory listing is not verification, and site participation never implies an individual family's benefits."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}
    >
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={r.payerId} className="grid grid-cols-[1fr_180px] items-center gap-3">
            <span className="text-[13px] font-medium">{r.payerName}</span>
            <Select aria-label={`${r.payerName} status`} value={r.status} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, status: e.target.value as typeof r.status } : y)))}>
              <option value="verified_accepted">Verified accepted</option>
              <option value="not_accepted">Not accepted</option>
              <option value="unknown">Unknown</option>
            </Select>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
