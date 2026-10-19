"use client";
import { ExternalLink, Plus, Printer, QrCode } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/misc";
import { api, ApiError } from "@/lib/client/api";
import { fmtDate, titleCase } from "@/lib/format";

type Partner = { id: string; businessName: string; category: string; sourceUrl: string | null; location: string | null; relationshipStatus: string; contactPermissionStatus: string; lastReviewedAt: string | null; codes: { id: string; code: string; status: string }[]; inquiries90d: number; starts90d: number };
type Packet = { id: string; kind: string; title: string; approvalStatus: string; revision: number; updatedAt: string; approvedAt: string | null };

const REL_TONE: Record<string, "good" | "neutral" | "warn"> = { active: "good", prospect: "neutral", paused: "warn" };
const MIN_CELL = 5;

export function ReferralsWorkspace({ partners, packets, qr, canManage, tz }: { partners: Partner[]; packets: Packet[]; qr: Record<string, string>; canManage: boolean; tz: string }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showQr, setShowQr] = useState<string | null>(null);
  const totalInq = partners.reduce((s, p) => s + p.inquiries90d, 0);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader title="Partners" description={`${partners.length} professional organizations · ${totalInq} code-attributed inquiries in the last 90 days`} actions={canManage && <Button variant="primary" size="sm" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" />Add partner</Button>} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[12.5px]" data-testid="partners-table">
            <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3"><th className="px-5 py-2">Organization</th><th className="px-3 py-2">Relationship</th><th className="px-3 py-2">Contact permission</th><th className="px-3 py-2">Codes</th><th className="px-3 py-2 text-right">Inquiries (90 d)</th><th className="px-3 py-2 text-right">Starts (90 d)</th></tr></thead>
            <tbody>
              {partners.map((p) => (
                <tr key={p.id} className="border-b border-line/70 last:border-0">
                  <td className="px-5 py-2.5">
                    <div className="font-medium">{p.businessName}</div>
                    <div className="text-[11.5px] text-ink-3">{titleCase(p.category)} · {p.location}{p.sourceUrl && <> · <a className="text-accent underline underline-offset-2" href={p.sourceUrl} target="_blank" rel="noreferrer noopener">listing <ExternalLink className="inline h-3 w-3" /></a></>}</div>
                  </td>
                  <td className="px-3 py-2.5"><Badge tone={REL_TONE[p.relationshipStatus] ?? "neutral"}>{titleCase(p.relationshipStatus)}</Badge></td>
                  <td className="px-3 py-2.5 text-ink-2">{titleCase(p.contactPermissionStatus)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-1">
                      {p.codes.map((c) => <button key={c.id} onClick={() => setShowQr(c.code)} className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 font-mono text-[11px] hover:bg-canvas"><QrCode className="h-3 w-3" />{c.code}</button>)}
                      {canManage && p.relationshipStatus !== "paused" && (
                        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" loading={busy === p.id} onClick={async () => {
                          setBusy(p.id);
                          try { const c = await api<{ code: string }>(`/partners/${p.id}/referral-code`, { body: {} }); toast.success(`Code ${c.code} created`); router.refresh(); } catch (e) { toast.error(e instanceof ApiError ? e.message : "Failed"); } finally { setBusy(null); }
                        }}>+ code</Button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular">{p.inquiries90d}</td>
                  <td className="px-3 py-2.5 text-right tabular">{p.starts90d > 0 && p.starts90d < MIN_CELL ? <span title="Small cell — share externally only as <5">{p.starts90d}</span> : p.starts90d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <CardBody className="border-t border-line text-[11.5px] text-ink-3">Internal aggregate view. Any partner-facing summary must suppress cells below {MIN_CELL} and never include family-level status.</CardBody>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader title="Referral packets & drafts" description="Approved packets can be printed locally. Nothing is emailed from CareFlow." />
          <CardBody className="space-y-2">
            {packets.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg border border-line p-2.5">
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-medium">{d.title}</div>
                  <div className="text-[11px] text-ink-3">r{d.revision} · {fmtDate(d.updatedAt, tz)}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge tone={d.approvalStatus === "approved" ? "good" : d.approvalStatus === "needs_review" ? "warn" : "neutral"}>{titleCase(d.approvalStatus)}</Badge>
                  {d.approvalStatus === "approved" && d.kind === "partner_packet" && <a href={`/referrals/packet/${d.id}`} target="_blank" rel="noreferrer" className="rounded p-1 text-ink-3 hover:bg-canvas" aria-label="Print packet"><Printer className="h-4 w-4" /></a>}
                </div>
              </div>
            ))}
            {packets.length === 0 && <EmptyState title="No packets yet">Approve an M2/M6 mission, then draft a referral packet from verified records.</EmptyState>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Compliance guardrails" />
          <CardBody className="space-y-1.5 text-[12.5px] text-ink-2">
            <p>• No referral fees, gifts, lead bounties or pay-per-referral functionality (anti-kickback).</p>
            <p>• Professional contacts only — never unsolicited family outreach or diagnosis-based targeting.</p>
            <p>• Codes are first-party, single-touch attribution; unattributed inquiries remain counted.</p>
            <p>• Packets list only staff-verified services, payers and service area, with verification caveats.</p>
          </CardBody>
        </Card>
      </div>

      {showQr && (
        <Dialog open onOpenChange={() => setShowQr(null)} title={`Attribution code ${showQr}`} description="Encodes the code only — no personal data, no tracking pixel, no external URL.">
          <div className="flex flex-col items-center gap-2">
            <img src={qr[showQr]} alt={`QR code for referral code ${showQr}`} className="h-40 w-40" />
            <span className="font-mono text-sm">{showQr}</span>
          </div>
        </Dialog>
      )}
      {adding && <AddPartner onClose={() => setAdding(false)} onDone={() => { setAdding(false); router.refresh(); }} />}
    </div>
  );
}

function AddPartner({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ businessName: "", category: "pediatrics", sourceUrl: "", location: "", relationshipStatus: "prospect", contactPermissionStatus: "not_requested" });
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api("/partners", { body: { ...f, sourceUrl: f.sourceUrl || null, location: f.location || null } });
      toast.success("Partner added");
      onDone();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Validation failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Add professional partner" description="Public professional listing data only. No patient details." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Add</Button></>}>
      <div className="grid gap-3">
        <div><Label>Business name</Label><Input value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} placeholder="e.g. Demo Pediatric Group" /></div>
        <div><Label>Category</Label><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{["pediatrics", "developmental_pediatrics", "speech_therapy", "occupational_therapy", "child_psychology", "family_medicine", "family_resource_center", "early_intervention", "other"].map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</Select></div>
        <div><Label>Public listing URL</Label><Input value={f.sourceUrl} onChange={(e) => setF({ ...f, sourceUrl: e.target.value })} placeholder="https://example.org/listing" /><FieldHint>Manually entered or imported public professional listing; no scraping.</FieldHint></div>
        <div><Label>Location (business)</Label><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></div>
      </div>
    </Dialog>
  );
}
