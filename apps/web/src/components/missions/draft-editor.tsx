"use client";
import { markdownToHtml } from "@careflow/core/markdown";
import type { ValidationResult } from "@careflow/core/content";
import { AlertTriangle, CheckCircle2, ExternalLink, Printer, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tip } from "@/components/ui/tooltip";
import { api, ApiError } from "@/lib/client/api";
import { titleCase } from "@/lib/format";

type Draft = { id: string; kind: string; locale: string; title: string; bodyMd: string; revision: number; approvalStatus: string; validation: ValidationResult; generator: string; approvedAt: string | null };

export function DraftEditor({ id, perms, onClose }: { id: string; perms: { edit: boolean; approveDraft: boolean; export: boolean }; onClose: () => void }) {
  const [d, setD] = useState<Draft | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api<Draft>(`/drafts/${id}`).then((x) => { setD(x); setBody(x.bodyMd); }).catch((e) => toast.error(e instanceof ApiError ? e.message : "Could not load draft"));
  }, [id]);

  async function call<T>(key: string, fn: () => Promise<T>, ok: string) {
    setBusy(key);
    try {
      const x = await fn();
      if (x && typeof x === "object" && "bodyMd" in (x as object)) { setD(x as unknown as Draft); setBody((x as unknown as Draft).bodyMd); }
      toast.success(ok);
    } catch (e) {
      if (e instanceof ApiError && e.details && typeof e.details === "object" && "issues" in (e.details as object)) setD((cur) => (cur ? { ...cur, validation: e.details as ValidationResult, approvalStatus: "needs_review" } : cur));
      toast.error(e instanceof ApiError ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  const dirty = d && body !== d.bodyMd;
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={d?.title ?? "Draft"}
      description={d && <span className="flex flex-wrap items-center gap-2"><Badge tone={d.approvalStatus === "approved" ? "good" : d.approvalStatus === "needs_review" ? "warn" : "neutral"} data-testid="draft-status">{titleCase(d.approvalStatus)}</Badge>{d.locale !== "en-US" && <Badge tone="blue" data-testid="draft-locale-badge">{d.locale === "es-US" ? "Spanish (es-US)" : d.locale}</Badge>}<span>Revision {d.revision} · generator: {d.generator === "template" ? "deterministic template (AI disabled)" : "AI paraphrase, validated"}</span></span>}
      footer={d && (
        <>
          <Tip content="Sending is disabled in the MVP. Drafts never auto-send or auto-publish.">
            <span><Button disabled><Send className="h-3.5 w-3.5" />Send (disabled)</Button></span>
          </Tip>
          {d.approvalStatus === "approved" && perms.export && (
            <>
              <a className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm font-medium hover:bg-canvas" href={`/api/v1/drafts/${d.id}/export?format=html`} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" />Local preview</a>
              {d.kind === "partner_packet" && <a className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm font-medium hover:bg-canvas" href={`/referrals/packet/${d.id}`} target="_blank" rel="noreferrer" data-testid="print-packet"><Printer className="h-3.5 w-3.5" />Printable packet</a>}
            </>
          )}
          {perms.edit && <Button disabled={!dirty} loading={busy === "save"} onClick={() => call("save", () => api<Draft>(`/drafts/${d.id}`, { method: "PUT", body: { bodyMd: body, revision: d.revision } }), "Saved — claims re-validated")}>Save edits</Button>}
          {perms.approveDraft && d.approvalStatus !== "approved" && (
            <Button variant="secondary" disabled={!!dirty} loading={busy === "approve"} onClick={() => call("approve", () => api<Draft>(`/drafts/${d.id}/approve`, { body: {} }), "Approved for local preview/export")} data-testid="approve-draft"><CheckCircle2 className="h-3.5 w-3.5" />Approve</Button>
          )}
        </>
      )}
    >
      {!d ? <p className="text-[13px] text-ink-3">Loading…</p> : (
        <>
          <div className={`mb-3 rounded-lg border px-3 py-2 text-[12.5px] ${d.validation.status === "pass" ? "border-good/30 bg-good-soft text-good" : "border-warn/30 bg-warn-soft text-warn"}`} data-testid="draft-validation">
            {d.validation.status === "pass" ? (
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" />Every payer, location, service and timeframe claim traces to verified records.</span>
            ) : (
              <div>
                <div className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4" />Needs review — unsupported claims block approval</div>
                <ul className="mt-1 list-disc pl-5">{d.validation.issues.map((i, k) => <li key={k}>{i.message}{i.excerpt ? `: “${i.excerpt}”` : ""}</li>)}</ul>
              </div>
            )}
          </div>
          {d.locale === "es-US" && (
            <div className="mb-3 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-[12.5px] text-warn" data-testid="draft-translation-note">
              <span className="flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" />Machine-authored Spanish template. Have a qualified human translator review it before any real use; the claim validator checks Spanish wording but is not a translation review.</span>
            </div>
          )}
          <Tabs defaultValue="preview">
            <TabsList><TabsTrigger value="preview">Preview</TabsTrigger>{perms.edit && <TabsTrigger value="edit">Edit Markdown</TabsTrigger>}</TabsList>
            <TabsContent value="preview" className="mt-3">
              <div lang={d.locale} className="prose-draft rounded-lg border border-line bg-surface p-4" dangerouslySetInnerHTML={{ __html: markdownToHtml(body) }} />
            </TabsContent>
            <TabsContent value="edit" className="mt-3">
              <Textarea lang={d.locale} aria-label="Draft markdown" rows={18} className="font-mono text-[12px]" value={body} onChange={(e) => setBody(e.target.value)} data-testid="draft-body" />
              <p className="mt-1 text-[11.5px] text-ink-3">Edits reset approval and are re-validated against current verified records on save.</p>
            </TabsContent>
          </Tabs>
        </>
      )}
    </Dialog>
  );
}
