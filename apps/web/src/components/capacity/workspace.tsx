"use client";
import { SERVICE_MODE_LABELS, windowLabel, type ServiceMode } from "@careflow/core/schemas";
import type { MatchResult } from "@careflow/core/matching";
import { Beaker, Clock, MapPin, Pencil, ShieldCheck, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/field";
import { MatchResults } from "@/components/match-results";
import { RequestFields, requestToPayload, type RequestState } from "@/components/request-fields";
import { api, ApiError } from "@/lib/client/api";
import { relativeDays } from "@/lib/format";
import { CapacityEditor, PayerEditor, type Sheet } from "./editors";

const PAYER_TONE = { verified_accepted: "good", not_accepted: "bad", unknown: "neutral" } as const;
const PAYER_LABEL = { verified_accepted: "Verified accepted", not_accepted: "Not accepted", unknown: "Unknown" } as const;

export function CapacityWorkspace({ sheets, payers, zctas, canEdit, canEditPayers, tz }: { sheets: Sheet[]; payers: { id: string; name: string }[]; zctas: { zcta5: string; label: string }[]; canEdit: boolean; canEditPayers: boolean; tz: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Sheet | null>(null);
  const [editingPayers, setEditingPayers] = useState<Sheet | null>(null);
  const meridian = payers.find((p) => p.name.startsWith("Meridian"));
  const DEMO: RequestState = { serviceZip: "00106", payerId: meridian?.id ?? "", modes: ["center"], days: [1, 3, 4], start: "14:00", end: "18:00", hours: "6" };
  const [req, setReq] = useState<RequestState>(DEMO);
  const [age, setAge] = useState("");
  const [result, setResult] = useState<MatchResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function evaluate(r = req) {
    setBusy(true);
    try {
      setResult(await api<MatchResult>("/matching/evaluate", { body: { ...requestToPayload(r), childAgeYears: age ? Number(age) : null } }));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Evaluation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_480px]">
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-1">
        {sheets.map((sh) => {
          const rbt = sh.windows.filter((w) => w.role === "RBT");
          const bcba = sh.windows.filter((w) => w.role === "BCBA");
          const unverified = sh.windows.filter((w) => !w.verifiedAt).length;
          const rule = sh.rules.find((r) => !r.payerId);
          const key = sh.center.name.split(" ")[0]!.toLowerCase();
          return (
            <Card key={sh.center.id} data-testid={`site-card-${key}`}>
              <CardHeader
                title={sh.center.name}
                description={<span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{sh.center.addressLine}, {sh.center.city} · fictional</span>}
                actions={
                  <>
                    {canEditPayers && <Button size="sm" onClick={() => setEditingPayers(sh)}>Payers</Button>}
                    {canEdit && <Button size="sm" variant="primary" onClick={() => setEditing(sh)} data-testid={`edit-capacity-${key}`}><Pencil className="h-3.5 w-3.5" />Edit capacity</Button>}
                  </>
                }
              />
              <CardBody className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-canvas p-3">
                    <div className="text-[11.5px] text-ink-3">Verified direct h/wk for new starts</div>
                    <div className="mt-1 text-2xl font-semibold tabular" data-testid={`card-verified-hours-${key}`}>{sh.summary?.hours ?? "—"}</div>
                    <div className="text-[11px] text-ink-3">{sh.summary?.reason}</div>
                  </div>
                  <div className="rounded-lg bg-canvas p-3">
                    <div className="text-[11.5px] text-ink-3">Pending verification</div>
                    <div className="mt-1 text-2xl font-semibold tabular text-warn">{sh.summary?.pendingHours ?? 0} h</div>
                    <div className="text-[11px] text-ink-3">{unverified} unverified window{unverified === 1 ? "" : "s"}</div>
                  </div>
                  <div className="rounded-lg bg-canvas p-3">
                    <div className="text-[11.5px] text-ink-3">Placement holds</div>
                    <div className="mt-1 text-2xl font-semibold tabular">{sh.holds.length}</div>
                    <div className="text-[11px] text-ink-3">{sh.holds.reduce((s, h) => s + h.directWeeklyHoursEstimate, 0)} h proposed</div>
                  </div>
                </div>
                <div>
                  <div className="eyebrow mb-1.5">Payer participation (staff-recorded)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {sh.payers.map((p) => (
                      <Badge key={p.payerId} tone={PAYER_TONE[p.status]} data-testid={`payer-${key}-${p.payerName.split(" ")[0]!.toLowerCase()}`}>
                        {p.payerName.replace(" (DEMO)", "")}: {PAYER_LABEL[p.status]}{p.lastVerifiedAt ? ` · ${relativeDays(p.lastVerifiedAt)}` : ""}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="grid gap-3 text-[12.5px] sm:grid-cols-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-ink-2"><ShieldCheck className="h-3.5 w-3.5" />{sh.center.serviceModes.map((m) => SERVICE_MODE_LABELS[m as ServiceMode]).join(" · ")}</div>
                    <div className="flex items-center gap-1.5 text-ink-2"><MapPin className="h-3.5 w-3.5" />{sh.center.serviceRadiusMiles} mi operational radius</div>
                    <div className="flex items-center gap-1.5 text-ink-2"><Users className="h-3.5 w-3.5" />Practice age policy {sh.center.acceptedAgeMin ?? "—"}–{sh.center.acceptedAgeMax ?? "—"}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-ink-2">BCBA supervision: <strong>{rule?.requiredBcbaHoursPerDirectHour ?? "—"}</strong> h per direct h {rule?.isVerified ? <Badge tone="good">verified rule</Badge> : <Badge tone="warn">unverified</Badge>}</div>
                    <div className="text-ink-2">Max new starts / week: <strong>{rule?.maxNewStartsPerWeek ?? "no limit"}</strong></div>
                    <div className="flex items-center gap-1.5 text-ink-3"><Clock className="h-3.5 w-3.5" />Sheet attested {relativeDays(sh.center.capacityVerifiedAt)}</div>
                  </div>
                </div>
                <details className="group">
                  <summary className="cursor-pointer text-[12.5px] font-medium text-accent">Staff availability windows ({rbt.length} RBT · {bcba.length} BCBA)</summary>
                  <div className="mt-2 grid gap-1 sm:grid-cols-2">
                    {sh.windows.map((w) => (
                      <div key={w.id} className="flex items-center justify-between rounded-md border border-line px-2 py-1 text-[12px]">
                        <span><Badge tone={w.role === "RBT" ? "blue" : "teal"}>{w.role}</Badge> {windowLabel(w)} <span className="text-ink-4">{w.serviceMode.replace("_if_applicable", "")}</span></span>
                        <span className="flex items-center gap-1.5 tabular">{w.weeklyAvailableHours} h {w.verifiedAt ? <span className="text-good" title="Verified">●</span> : <span className="text-warn" title="Pending verification">○</span>}</span>
                      </div>
                    ))}
                  </div>
                </details>
              </CardBody>
            </Card>
          );
        })}
      </div>

      <div className="xl:sticky xl:top-20 xl:self-start">
        <Card>
          <CardHeader
            title="Test a match"
            description="Deterministic, non-persistent evaluation against current verified capacity."
            actions={<Button size="sm" variant="ghost" onClick={() => { setReq(DEMO); setAge(""); void evaluate(DEMO); }}><Beaker className="h-3.5 w-3.5" />Load acceptance scenario</Button>}
          />
          <CardBody>
            <RequestFields idPrefix="match" value={req} onChange={setReq} payers={payers} zctas={zctas} />
            <div className="mt-3 grid grid-cols-2 items-end gap-3">
              <div>
                <Label htmlFor="age">Age (optional, policy check only)</Label>
                <Input id="age" type="number" min={0} max={21} value={age} onChange={(e) => setAge(e.target.value)} />
              </div>
              <Button variant="primary" onClick={() => evaluate()} loading={busy} disabled={req.modes.length === 0} data-testid="evaluate-match">Evaluate match</Button>
            </div>
            <div className="mt-4">{result ? <MatchResults result={result} /> : <p className="text-[12.5px] text-ink-3">Run an evaluation to see ranked candidate sites, hard gates and score components.</p>}</div>
          </CardBody>
        </Card>
      </div>

      {editing && <CapacityEditor sheet={editing} payers={payers} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); router.refresh(); if (result) await evaluate(); }} />}
      {editingPayers && <PayerEditor sheet={editingPayers} onClose={() => setEditingPayers(null)} onSaved={async () => { setEditingPayers(null); router.refresh(); if (result) await evaluate(); }} />}
    </div>
  );
}
