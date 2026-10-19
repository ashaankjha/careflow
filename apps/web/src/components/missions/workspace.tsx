"use client";
import { MISSION_RULES } from "@careflow/core/missions";
import { CheckCircle2, FileText, FlaskConical, Gauge, ShieldAlert, Sparkles, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/field";
import { EmptyState, Meter } from "@/components/ui/misc";
import { Tip } from "@/components/ui/tooltip";
import { api, ApiError } from "@/lib/client/api";
import { fmtDateTime, titleCase } from "@/lib/format";
import { DraftEditor } from "./draft-editor";
import { ExperimentDialog } from "./experiment-dialog";

export type Mission = {
  id: string;
  centerId: string | null;
  centerName: string | null;
  ruleId: keyof typeof MISSION_RULES;
  category: string;
  title: string;
  explanation: string;
  proposedAction: string;
  guardrail: string;
  expectedDirection: string;
  impactScore: number;
  effortScore: number;
  confidenceScore: number;
  priorityScore: number;
  requiresOpsReview: boolean;
  increasesDemand: boolean;
  status: "proposed" | "approved" | "rejected" | "in_progress" | "done";
  reviewNote: string | null;
  reviewedAt: string | null;
  generatedAt: string;
  draftKinds: string[];
  experimentTemplate: { hypothesis: string; primaryMetric: string; guardrails: string[]; assignmentUnit: string; designType: string };
  evidence: { id: string; metricKey: string; label: string; numerator: number; denominator: number | null; timeRange: string; eventCount: number; verifiedAt: string }[];
  drafts: { id: string; kind: string; title: string; approvalStatus: string; revision: number }[];
  experiments: { id: string; name: string; status: string; designType: string }[];
};

type Perms = { generate: boolean; approve: boolean; approveOps: boolean; status: boolean; draft: boolean; edit: boolean; approveDraft: boolean; export: boolean; experiment: boolean };

const STATUS_TONE = { proposed: "blue", approved: "good", rejected: "neutral", in_progress: "teal", done: "ink" } as const;
const DRAFT_LABEL: Record<string, string> = { partner_packet: "Referral packet", referral_email: "Partner email", seo_page: "Location page", internal_plan: "Internal plan" };

export function MissionsWorkspace({ missions, partners, perms, tz }: { missions: Mission[]; partners: { id: string; name: string }[]; perms: Perms; tz: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState("open");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [expMission, setExpMission] = useState<Mission | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [partnerFor, setPartnerFor] = useState<Record<string, string>>({});

  async function run(key: string, fn: () => Promise<unknown>, ok: string | ((r: unknown) => string)) {
    setBusy(key);
    try {
      const r = await fn();
      toast.success(typeof ok === "function" ? ok(r) : ok);
      router.refresh();
      return r;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  const shown = missions.filter((m) => (filter === "open" ? ["proposed", "approved", "in_progress"].includes(m.status) : filter === "all" ? true : m.status === filter));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select aria-label="Status filter" className="w-44" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="open">Open</option>
          <option value="all">All</option>
          <option value="proposed">Proposed</option>
          <option value="approved">Approved</option>
          <option value="in_progress">In progress</option>
          <option value="done">Done</option>
          <option value="rejected">Rejected</option>
        </Select>
        <span className="text-[12.5px] text-ink-3">{shown.length} mission{shown.length === 1 ? "" : "s"} · priority = impact × confidence ÷ effort (bounded scores, no dollar promises)</span>
        {perms.generate && (
          <Button
            variant="primary"
            className="ml-auto"
            loading={busy === "generate"}
            data-testid="generate-missions"
            onClick={() => run("generate", () => api<{ created: number; refreshed: number; unchanged: number }>("/missions/generate", { body: {} }), (r) => {
              const x = r as { created: number; refreshed: number; unchanged: number };
              return `Rules evaluated: ${x.created} new, ${x.refreshed} refreshed, ${x.unchanged} already reviewed`;
            })}
          >
            <Sparkles className="h-4 w-4" />Generate from current data
          </Button>
        )}
      </div>

      {shown.length === 0 && <EmptyState icon={<Gauge className="h-6 w-6" />} title="No missions in this view">Missions appear only when verified intake/operations evidence supports them.</EmptyState>}

      <div className="space-y-4">
        {shown.map((m) => {
          const canApprove = m.requiresOpsReview ? perms.approveOps : perms.approve;
          const active = m.status === "approved" || m.status === "in_progress";
          return (
            <Card key={m.id} id={m.id} className="scroll-mt-24 overflow-hidden" data-testid={`mission-${m.ruleId}-${(m.centerName ?? "org").split(" ")[0]!.toLowerCase()}`} data-status={m.status}>
              <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_300px]">
                <div className="min-w-0 p-5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="ink">{m.ruleId}</Badge>
                    <Badge tone="outline">{m.category}</Badge>
                    {m.centerName && <Badge tone="neutral">{m.centerName}</Badge>}
                    <Badge tone={STATUS_TONE[m.status]}>{titleCase(m.status)}</Badge>
                    {m.requiresOpsReview && <Badge tone="warn"><ShieldAlert className="h-3 w-3" />Ops sign-off required</Badge>}
                    {m.increasesDemand && <Tip content="Only generated when the site has verified, unsaturated capacity; re-checked at approval."><Badge tone="blue">Demand-increasing · capacity-gated</Badge></Tip>}
                  </div>
                  <h3 className="mt-2.5 break-words text-[16px] font-semibold leading-6">{m.title}</h3>
                  <p className="mt-1 text-[13px] leading-6 text-ink-2">{m.explanation}</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg bg-canvas p-3"><div className="eyebrow mb-1">Proposed action</div><p className="text-[12.5px] leading-5 text-ink-2">{m.proposedAction}</p></div>
                    <div className="rounded-lg bg-canvas p-3"><div className="eyebrow mb-1">Guardrail</div><p className="text-[12.5px] leading-5 text-ink-2">{m.guardrail}</p><p className="mt-1.5 text-[12px] text-ink-3">Expected direction: {m.expectedDirection} (uncertain; measured later)</p></div>
                  </div>
                  <div className="mt-3">
                    <div className="eyebrow mb-1.5">Evidence (saved metrics)</div>
                    <table className="w-full text-[12.5px]" data-testid="mission-evidence">
                      <tbody>
                        {m.evidence.map((e) => (
                          <tr key={e.id} className="border-t border-line/70">
                            <td className="py-1.5 pr-3 text-ink-2">{e.label}</td>
                            <td className="py-1.5 pr-3 font-semibold tabular">{e.numerator}{e.denominator != null ? <span className="font-normal text-ink-3"> / {e.denominator}</span> : null}</td>
                            <td className="py-1.5 pr-3 text-ink-3">{e.timeRange}</td>
                            <td className="hidden py-1.5 text-right font-mono text-[11px] text-ink-4 sm:table-cell">{e.metricKey}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="mt-1 text-[11px] text-ink-4">Generated {fmtDateTime(m.generatedAt, tz)} · rule {m.ruleId} ({MISSION_RULES[m.ruleId]})</div>
                  </div>
                  {m.reviewNote && <p className="mt-2 text-[12px] text-ink-3">Review note: “{m.reviewNote}”</p>}
                </div>

                <div className="border-t border-line bg-canvas/50 p-5 lg:border-l lg:border-t-0">
                  <div className="space-y-2 text-[12px]">
                    {[["Impact (directional)", m.impactScore / 5], ["Confidence", m.confidenceScore], ["Effort", m.effortScore / 5]].map(([k, v]) => (
                      <div key={k as string}><div className="mb-0.5 flex justify-between text-ink-3"><span>{k as string}</span><span className="tabular">{(v as number).toFixed(2)}</span></div><Meter value={v as number} tone={k === "Effort" ? "warn" : "blue"} label={k as string} /></div>
                    ))}
                    <div className="flex justify-between pt-1 text-ink-2"><span>Priority score</span><span className="font-semibold tabular">{m.priorityScore.toFixed(2)}</span></div>
                  </div>

                  {m.status === "proposed" && (
                    <div className="mt-4 space-y-2">
                      {canApprove ? (
                        <>
                          <Label htmlFor={`note-${m.id}`}>Review note (optional)</Label>
                          <Input id={`note-${m.id}`} value={notes[m.id] ?? ""} onChange={(e) => setNotes({ ...notes, [m.id]: e.target.value })} placeholder={m.requiresOpsReview ? "Ops confirms availability & payers" : ""} />
                          <div className="flex gap-2">
                            <Button variant="secondary" size="sm" loading={busy === `a-${m.id}`} onClick={() => run(`a-${m.id}`, () => api(`/missions/${m.id}/approve`, { body: { note: notes[m.id] || undefined } }), "Mission approved")} data-testid="approve-mission"><CheckCircle2 className="h-3.5 w-3.5" />Approve</Button>
                            {perms.approve && <Button variant="danger" size="sm" loading={busy === `r-${m.id}`} onClick={() => run(`r-${m.id}`, () => api(`/missions/${m.id}/reject`, { body: { note: notes[m.id] || undefined } }), "Mission rejected")}><XCircle className="h-3.5 w-3.5" />Reject</Button>}
                          </div>
                        </>
                      ) : (
                        <p className="rounded-md bg-warn-soft px-2.5 py-2 text-[12px] text-warn">{m.requiresOpsReview ? "Requires an Operations director (or admin) to approve availability and payer details." : "Your role cannot approve missions."}</p>
                      )}
                    </div>
                  )}

                  {active && (
                    <div className="mt-4 space-y-3">
                      {perms.draft && m.draftKinds.length > 0 && (
                        <div>
                          <div className="eyebrow mb-1.5">Draft outputs (review-only)</div>
                          {m.draftKinds.includes("referral_email") && partners.length > 0 && (
                            <Select aria-label="Partner for personalized drafts" className="mb-2 h-8 text-[12.5px]" value={partnerFor[m.id] ?? ""} onChange={(e) => setPartnerFor({ ...partnerFor, [m.id]: e.target.value })}>
                              <option value="">No specific partner</option>
                              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </Select>
                          )}
                          <div className="flex flex-wrap gap-1.5">
                            {m.draftKinds.map((k) => (
                              <Button key={k} size="sm" loading={busy === `d-${m.id}-${k}`} data-testid={`generate-draft-${k}`} onClick={async () => {
                                const d = (await run(`d-${m.id}-${k}`, () => api<{ id: string }>("/drafts/generate", { body: { missionId: m.id, kind: k, partnerId: partnerFor[m.id] || null } }), `${DRAFT_LABEL[k]} drafted from verified records`)) as { id: string } | undefined;
                                if (d?.id) setDraftId(d.id);
                              }}><FileText className="h-3.5 w-3.5" />{DRAFT_LABEL[k]}</Button>
                            ))}
                          </div>
                        </div>
                      )}
                      {m.drafts.length > 0 && (
                        <ul className="space-y-1">
                          {m.drafts.map((d) => (
                            <li key={d.id}>
                              <button className="flex w-full items-center justify-between gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-left text-[12px] hover:border-accent/40" onClick={() => setDraftId(d.id)} data-testid={`draft-${d.kind}`}>
                                <span className="truncate">{DRAFT_LABEL[d.kind]} · r{d.revision}</span>
                                <Badge tone={d.approvalStatus === "approved" ? "good" : d.approvalStatus === "needs_review" ? "warn" : "neutral"}>{titleCase(d.approvalStatus)}</Badge>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {m.experiments.length > 0 ? (
                        m.experiments.map((x) => (
                          <Link key={x.id} href={`/experiments?id=${x.id}`} className="flex items-center justify-between rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] hover:border-accent/40" data-testid="mission-experiment-link">
                            <span className="flex items-center gap-1.5 truncate"><FlaskConical className="h-3.5 w-3.5" />{x.name}</span>
                            <Badge tone={x.status === "active" ? "teal" : "neutral"}>{x.status}</Badge>
                          </Link>
                        ))
                      ) : (
                        perms.experiment && <Button size="sm" variant="primary" onClick={() => setExpMission(m)} data-testid="start-experiment"><FlaskConical className="h-3.5 w-3.5" />Connect experiment</Button>
                      )}
                      {perms.status && (
                        <div className="flex gap-2">
                          {m.status === "approved" && <Button size="sm" variant="ghost" onClick={() => run(`s-${m.id}`, () => api(`/missions/${m.id}/status`, { body: { status: "in_progress" } }), "Marked in progress")}>Mark in progress</Button>}
                          <Button size="sm" variant="ghost" onClick={() => run(`s-${m.id}`, () => api(`/missions/${m.id}/status`, { body: { status: "done" } }), "Marked completed")}>Mark completed</Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {draftId && <DraftEditor id={draftId} perms={perms} onClose={() => { setDraftId(null); router.refresh(); }} />}
      {expMission && <ExperimentDialog mission={expMission} onClose={() => setExpMission(null)} onCreated={() => { setExpMission(null); router.refresh(); }} />}
    </div>
  );
}
