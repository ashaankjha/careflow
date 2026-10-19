"use client";
import { allowedTransitions, requiresReason, STAGE_LABELS, type Stage } from "@careflow/core/stages";
import { SERVICE_MODE_LABELS, SOURCE_LABELS, windowLabel, type ServiceMode, type SourceChannel, type TimeWindow } from "@careflow/core/schemas";
import type { MatchResult } from "@careflow/core/matching";
import { Camera, PhoneOutgoing, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge, SyntheticBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/field";
import { KeyValue } from "@/components/ui/misc";
import { MatchResults } from "@/components/match-results";
import { api, ApiError, idemKey } from "@/lib/client/api";
import { fmtDateTime, titleCase } from "@/lib/format";
import { stageTone, type Option, type Perms } from "./workspace";

type Detail = {
  inquiry: {
    id: string;
    contactAlias: string;
    stage: Stage;
    serviceZip: string;
    preferredModes: string[];
    preferredTimeWindows: TimeWindow[];
    requestedDirectHours: number | null;
    sourceChannel: string;
    sourceReferralCode: string | null;
    centerId: string | null;
    intakeOwnerId: string | null;
    createdAt: string;
    stageEnteredAt: string;
  };
  events: { id: string; eventType: string; previousStage: string | null; nextStage: string | null; occurredAt: string; actorSource: string; actorName: string | null; metadata: Record<string, unknown> }[];
  center: { id: string; name: string } | null;
  payer: { id: string; name: string } | null;
  referral: { code: string; partnerName: string | null } | null;
};

type Hold = {
  id: string;
  centerId: string;
  centerName: string;
  status: "proposed" | "reserved" | "released";
  effectiveStatus: "proposed" | "reserved" | "released" | "expired";
  active: boolean;
  directWeeklyHoursEstimate: number;
  bcbaWeeklyHoursEstimate: number;
  expiresAt: string;
  reservedAt: string | null;
  releasedAt: string | null;
  releaseReason: string | null;
};
type Holds = { holds: Hold[]; disclaimer: string; canReserve: boolean; canRelease: boolean };

const HOLD_STATUS: Record<Hold["effectiveStatus"], { label: string; tone: "good" | "warn" | "ink" | "outline" }> = {
  reserved: { label: "Reserved — not an appointment", tone: "good" },
  proposed: { label: "Proposed", tone: "warn" },
  released: { label: "Released", tone: "outline" },
  expired: { label: "Expired", tone: "outline" },
};

export function InquiryDrawer({ id, onClose, perms, owners, centers, tz }: { id: string | null; onClose: () => void; perms: Perms; owners: { id: string; displayName: string }[]; centers: Option[]; tz: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [match, setMatch] = useState<{ result: MatchResult; snapshots: { generatedAt: string }[] } | null>(null);
  const [holds, setHolds] = useState<Holds | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Stage | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [d, m, h] = await Promise.all([
        api<Detail>(`/inquiries/${id}`),
        api<{ result: MatchResult; snapshots: { generatedAt: string }[] }>(`/inquiries/${id}/matches`),
        api<Holds>(`/inquiries/${id}/holds`),
      ]);
      setDetail(d);
      setMatch(m);
      setHolds(h);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load inquiry");
    }
  }, [id]);

  useEffect(() => {
    setDetail(null);
    setMatch(null);
    setHolds(null);
    setPending(null);
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      setPending(null);
      setReason("");
      await load();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const transition = (to: Stage) => {
    const from = detail!.inquiry.stage;
    if (requiresReason(from, to) && !pending) {
      setPending(to);
      return;
    }
    void act(() => api(`/inquiries/${id}/transition`, { body: { toStage: to, reason: reason || null, eventIdempotencyKey: idemKey("tr") } }), `Moved to ${STAGE_LABELS[to]}`);
  };

  const inq = detail?.inquiry;
  const next = inq ? allowedTransitions(inq.stage) : [];
  const forward = next.filter((s) => !["waitlisted", "closed_unserviceable", "withdrawn", "inactive"].includes(s));
  const exits = next.filter((s) => !forward.includes(s));
  const reservedHold = holds?.holds.find((h) => h.effectiveStatus === "reserved") ?? null;
  const canReserveHere = !!holds?.canReserve && !!inq && !["started", "closed_unserviceable", "withdrawn", "inactive"].includes(inq.stage);

  return (
    <Sheet
      open={!!id}
      onOpenChange={(o) => !o && onClose()}
      title={inq ? inq.contactAlias : "Inquiry"}
      description={inq && (
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={stageTone(inq.stage)} data-testid="drawer-stage">{STAGE_LABELS[inq.stage]}</Badge>
          <SyntheticBadge />
          <span>Created {fmtDateTime(inq.createdAt, tz)}</span>
        </span>
      )}
    >
      {error && (
        <div className="m-6 rounded-lg border border-bad/30 bg-bad-soft p-4 text-[13px] text-bad">
          {error} <Button size="sm" className="ml-2" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" />Retry</Button>
        </div>
      )}
      {!inq && !error && <div className="p-6 text-[13px] text-ink-3">Loading…</div>}
      {inq && detail && (
        <div className="space-y-5 p-6">
          {perms.transition && (
            <section aria-label="Quick actions" className="rounded-xl border border-line bg-surface p-4">
              <div className="eyebrow mb-2">Next administrative step</div>
              <div className="flex flex-wrap gap-2">
                {forward.map((s) => (
                  <Button key={s} variant={s === "started" ? "secondary" : "primary"} size="sm" loading={busy && !pending} onClick={() => transition(s)} data-testid={`transition-${s}`}>
                    {s === "started" ? "Record verified care start" : `Move to ${STAGE_LABELS[s]}`}
                  </Button>
                ))}
                <Button size="sm" onClick={() => void act(() => api(`/inquiries/${id}/outreach`, { body: { eventIdempotencyKey: idemKey("out") } }), "Outreach attempt logged")} data-testid="log-outreach">
                  <PhoneOutgoing className="h-3.5 w-3.5" />Log outreach attempt
                </Button>
                {exits.length > 0 && (
                  <Select aria-label="Exit or waitlist" className="h-8 w-44 text-[13px]" value="" onChange={(e) => e.target.value && transition(e.target.value as Stage)}>
                    <option value="">Waitlist / close…</option>
                    {exits.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                  </Select>
                )}
              </div>
              {pending && (
                <div className="mt-3 rounded-lg border border-warn/30 bg-warn-soft/50 p-3">
                  <Label htmlFor="reason">Reason for moving to {STAGE_LABELS[pending]} (required, administrative only)</Label>
                  <div className="flex gap-2">
                    <Input id="reason" value={reason} maxLength={280} onChange={(e) => setReason(e.target.value)} placeholder="e.g. No verified capacity in preferred windows" />
                    <Button variant="primary" size="sm" className="h-9" disabled={!reason.trim()} loading={busy} onClick={() => transition(pending)}>Confirm</Button>
                    <Button size="sm" className="h-9" variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
                  </div>
                </div>
              )}
              {inq.stage !== "started" && (
                <p className="mt-3 text-[11.5px] text-ink-3">Insurance verification is a human-entered outcome. A care start can only be recorded after a site is selected and staff verify it.</p>
              )}
            </section>
          )}

          <section className="grid gap-4 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
            <div>
              <KeyValue k="Service ZCTA" v={inq.serviceZip} />
              <KeyValue k="Payer (as recorded)" v={detail.payer?.name ?? "Not recorded"} />
              <KeyValue k="Preferred modes" v={inq.preferredModes.map((m) => SERVICE_MODE_LABELS[m as ServiceMode] ?? m).join(", ")} />
              <KeyValue k="Requested direct h/wk" v={inq.requestedDirectHours ?? "Not provided"} />
            </div>
            <div>
              <KeyValue k="Source" v={SOURCE_LABELS[inq.sourceChannel as SourceChannel] ?? inq.sourceChannel} />
              <KeyValue k="Referral code" v={detail.referral ? `${detail.referral.code} · ${detail.referral.partnerName?.replace(" (DEMO)", "") ?? "campaign"}` : inq.sourceReferralCode ? `${inq.sourceReferralCode} (unrecognized)` : "Unattributed"} />
              <KeyValue k="Target site" v={detail.center?.name ?? "Not selected"} />
              <div className="flex items-center justify-between gap-3 py-1 text-[13px]">
                <span className="text-ink-3">Owner</span>
                {perms.transition ? (
                  <Select aria-label="Intake owner" className="h-7 w-40 text-[12.5px]" value={inq.intakeOwnerId ?? ""} onChange={(e) => void act(() => api(`/inquiries/${id}/owner`, { body: { ownerId: e.target.value || null } }), "Owner updated")}>
                    <option value="">Unassigned</option>
                    {owners.map((o) => <option key={o.id} value={o.id}>{o.displayName}</option>)}
                  </Select>
                ) : (
                  <span className="font-medium">{owners.find((o) => o.id === inq.intakeOwnerId)?.displayName ?? "Unassigned"}</span>
                )}
              </div>
            </div>
            <div className="sm:col-span-2">
              <div className="text-[12px] text-ink-3">Preferred windows</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {inq.preferredTimeWindows.length ? inq.preferredTimeWindows.map((w, i) => <Badge key={i} tone="outline">{windowLabel(w)}</Badge>) : <span className="text-[12.5px] text-ink-4">Not recorded</span>}
              </div>
            </div>
          </section>

          <section aria-label="Center suggestions">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[14px] font-semibold">Center suggestions</h3>
              {perms.persist && (
                <Button size="sm" variant="ghost" onClick={() => void act(() => api(`/inquiries/${id}/matches`, { body: {} }), "Match snapshot saved with explanations")}>
                  <Camera className="h-3.5 w-3.5" />Save snapshot{match?.snapshots.length ? ` (${match.snapshots.length})` : ""}
                </Button>
              )}
            </div>
            {match ? (
              <MatchResults
                result={match.result}
                selectable={perms.persist}
                selectedCenterId={inq.centerId}
                onSelect={(centerId) => void act(() => api(`/inquiries/${id}/select-center`, { body: { centerId, idempotencyKey: idemKey("sel") } }), `Target site set: ${centers.find((c) => c.id === centerId)?.name}`)}
                reservedCenterId={reservedHold?.centerId ?? null}
                onReserve={
                  canReserveHere
                    ? (centerId) => void act(() => api(`/inquiries/${id}/holds`, { body: { centerId } }), `Capacity hold reserved at ${centers.find((c) => c.id === centerId)?.name} — not an appointment`)
                    : undefined
                }
              />
            ) : (
              <div className="text-[13px] text-ink-3">Evaluating…</div>
            )}
          </section>

          {holds && holds.holds.length > 0 && (
            <section aria-label="Capacity holds" className="rounded-xl border border-line bg-surface p-4" data-testid="holds">
              <h3 className="mb-1 text-[14px] font-semibold">Capacity holds</h3>
              <p className="mb-3 text-[11.5px] leading-5 text-ink-3">{holds.disclaimer}</p>
              <ul className="space-y-2">
                {holds.holds.map((h) => {
                  const st = HOLD_STATUS[h.effectiveStatus];
                  return (
                    <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-[12.5px]" data-testid={`hold-${h.effectiveStatus}`}>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{h.centerName}</span>
                        <Badge tone={st.tone}>{st.label}</Badge>
                        <span className="text-ink-3 tabular">{h.directWeeklyHoursEstimate} direct h/wk · {h.bcbaWeeklyHoursEstimate.toFixed(1)} BCBA h/wk</span>
                      </span>
                      <span className="flex items-center gap-2 text-[11.5px] text-ink-3">
                        {h.active ? `Expires ${fmtDateTime(h.expiresAt, tz)}` : h.releasedAt ? `Released ${fmtDateTime(h.releasedAt, tz)}${h.releaseReason ? ` · ${titleCase(h.releaseReason)}` : ""}` : `Expired ${fmtDateTime(h.expiresAt, tz)}`}
                        {h.active && holds.canRelease && (
                          <Button size="sm" variant="ghost" loading={busy} onClick={() => void act(() => api(`/holds/${h.id}/release`, { body: {} }), "Capacity hold released")} data-testid="release-hold">
                            Release
                          </Button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section aria-label="Event timeline">
            <h3 className="mb-2 text-[14px] font-semibold">Immutable event timeline</h3>
            <ol className="relative space-y-3 border-l border-line pl-4" data-testid="timeline">
              {detail.events.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-surface bg-series-1" aria-hidden />
                  <div className="text-[12.5px] font-medium">{titleCase(e.eventType)}{e.nextStage && e.previousStage ? ` · ${STAGE_LABELS[e.previousStage as Stage]} → ${STAGE_LABELS[e.nextStage as Stage]}` : ""}</div>
                  <div className="text-[11.5px] text-ink-3">
                    {fmtDateTime(e.occurredAt, tz)} · {e.actorName ?? titleCase(e.actorSource)}
                    {typeof e.metadata?.reason === "string" && e.metadata.reason ? ` · “${e.metadata.reason}”` : ""}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </Sheet>
  );
}
