"use client";
import { SOURCE_LABELS, type SourceChannel } from "@careflow/core/schemas";
import { ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Select } from "@/components/ui/field";
import { RequestFields, requestToPayload, type RequestState } from "@/components/request-fields";
import { api, ApiError, idemKey } from "@/lib/client/api";

export function AddInquiryDialog({ open, onOpenChange, payers, centers, zctas, onCreated }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  payers: { id: string; name: string }[];
  centers: { id: string; name: string }[];
  zctas: { zcta5: string; label: string }[];
  onCreated: (id: string) => void;
}) {
  const [alias, setAlias] = useState("");
  const [req, setReq] = useState<RequestState>({ serviceZip: zctas[5]?.zcta5 ?? "00106", payerId: "", modes: ["center"], days: [1, 3, 4], start: "14:00", end: "18:00", hours: "6" });
  const [source, setSource] = useState<SourceChannel>("website_form");
  const [code, setCode] = useState("");
  const [centerId, setCenterId] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(() => idemKey("create"));

  useEffect(() => {
    if (open) {
      setAlias(`Demo Family ${Math.floor(500 + Math.random() * 499)}`);
      setKey(idemKey("create"));
      setError(null);
      setAck(false);
    }
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ inquiry: { id: string }; replayed: boolean }>("/inquiries", {
        body: { ...requestToPayload(req), contactAlias: alias, sourceChannel: source, referralCode: code || null, centerId: centerId || null, idempotencyKey: key, syntheticAcknowledged: ack },
      });
      toast.success(res.replayed ? "Retry detected — original inquiry returned" : "Synthetic inquiry created");
      onCreated(res.inquiry.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create inquiry");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Add simulated inquiry"
      description="First-party demo interest form. Inputs are not transmitted to any analytics or ad platform."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!ack || req.modes.length === 0} onClick={submit} data-testid="submit-inquiry">Create inquiry</Button>
        </>
      }
    >
      <div className="mb-4 flex gap-2 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2.5 text-[13px] text-warn" role="alert">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <div><strong>Demo — do not enter real personal or health information.</strong> Use a fake alias such as “Demo Family 042”. Strings that look like real emails, phone numbers, addresses or clinical terms are rejected.</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="alias">Demo alias</Label>
          <Input id="alias" value={alias} onChange={(e) => setAlias(e.target.value)} maxLength={60} />
          <FieldHint>Must start with Demo, Test, Synthetic or Sample.</FieldHint>
        </div>
        <div>
          <Label htmlFor="source">Source channel</Label>
          <Select id="source" value={source} onChange={(e) => setSource(e.target.value as SourceChannel)}>
            {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
      </div>
      <div className="mt-3"><RequestFields idPrefix="add" value={req} onChange={setReq} payers={payers} zctas={zctas} /></div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="code">Referral code (optional)</Label>
          <Input id="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. BAYPEDS" maxLength={32} />
          <FieldHint>Unrecognized or missing codes stay counted as unattributed.</FieldHint>
        </div>
        <div>
          <Label htmlFor="center">Landing site (optional)</Label>
          <Select id="center" value={centerId} onChange={(e) => setCenterId(e.target.value)}>
            <option value="">Not routed yet</option>
            {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
      </div>
      <label className="mt-4 flex items-start gap-2 text-[13px]">
        <input type="checkbox" className="mt-0.5 accent-[#1F5FBF]" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="synthetic-ack" />
        I confirm this entry is synthetic test data and contains no real person’s information.
      </label>
      {error && <p role="alert" className="mt-3 rounded-md bg-bad-soft px-3 py-2 text-[13px] text-bad" data-testid="inquiry-error">{error}</p>}
    </Dialog>
  );
}
