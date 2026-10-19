"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";
import type { Mission } from "./workspace";

export function ExperimentDialog({ mission, onClose, onCreated }: { mission: Mission; onClose: () => void; onCreated: () => void }) {
  const t = mission.experimentTemplate;
  const [name, setName] = useState(`${mission.centerName ?? "Org"}: ${mission.category}`);
  const [hypothesis, setHypothesis] = useState(t.hypothesis);
  const [metric, setMetric] = useState(t.primaryMetric);
  const [design, setDesign] = useState(t.designType);
  const [unit, setUnit] = useState(t.assignmentUnit);
  const [baseline, setBaseline] = useState(60);
  const [duration, setDuration] = useState(84);
  const [startNow, setStartNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const randomized = design === "randomized";

  async function submit() {
    setBusy(true);
    try {
      const e = await api<{ id: string }>("/experiments", {
        body: {
          centerId: mission.centerId,
          missionId: mission.id,
          name,
          hypothesis,
          primaryMetric: metric,
          guardrailMetrics: t.guardrails,
          designType: design,
          assignmentUnit: randomized ? unit : unit === "none" ? "none" : unit,
          baselineDays: baseline,
          plannedDurationDays: duration,
          variants: randomized
            ? [
                { key: "control", description: "Current materials / process", allocationPct: 50 },
                { key: "treatment", description: "Approved new factual material", allocationPct: 50 },
              ]
            : [],
        },
      });
      if (startNow) await api(`/experiments/${e.id}/start`, { body: {} });
      toast.success(startNow ? "Experiment created and started" : "Experiment created (draft)");
      onCreated();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not create experiment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} wide title="Connect a measured experiment" description="Prefilled from the mission's evidence. All families receive the same intake and care regardless of arm."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit} data-testid="create-experiment">{startNow ? "Create & start" : "Create draft"}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label htmlFor="xn">Name</Label><Input id="xn" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor="xh">Hypothesis</Label><Textarea id="xh" rows={3} value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} /></div>
        <div><Label htmlFor="xm">Primary metric</Label><Input id="xm" value={metric} onChange={(e) => setMetric(e.target.value)} /></div>
        <div><Label>Guardrails</Label><div className="flex h-9 items-center text-[12px] text-ink-2">{t.guardrails.join(", ")}</div></div>
        <div>
          <Label htmlFor="xd">Design</Label>
          <Select id="xd" value={design} onChange={(e) => setDesign(e.target.value)}>
            <option value="observational">Observational (descriptive)</option>
            <option value="quasi_experimental">Quasi-experimental</option>
            <option value="randomized">Randomized</option>
          </Select>
          <FieldHint>Randomized requires persisted HMAC assignments on start.</FieldHint>
        </div>
        <div>
          <Label htmlFor="xu">Assignment unit</Label>
          <Select id="xu" value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="partner">Referral partner</option>
            <option value="site_week">Site-week</option>
            <option value="none" disabled={randomized}>None</option>
          </Select>
          <FieldHint>Prefer partner or site-week units; never randomize families’ access to care.</FieldHint>
        </div>
        <div><Label htmlFor="xb">Baseline window (days)</Label><Input id="xb" type="number" min={7} value={baseline} onChange={(e) => setBaseline(Number(e.target.value))} /></div>
        <div><Label htmlFor="xp">Planned duration (days)</Label><Input id="xp" type="number" min={7} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /><FieldHint>Should exceed typical inquiry-to-start time (~40 days) to avoid censoring.</FieldHint></div>
      </div>
      <label className="mt-4 flex items-center gap-2 text-[13px]"><input type="checkbox" className="accent-[#1F5FBF]" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} />Start now (persists assignments for randomized designs)</label>
    </Dialog>
  );
}
