"use client";
import { CSV_TEMPLATE } from "@careflow/core/csv";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label, Textarea } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";

type Preview = { validRows: number; newRows: number; duplicates: number; errors: { line: number; column?: string; message: string }[]; sample: { externalId: string; contactAlias: string; serviceZip: string; sourceChannel: string }[]; committed: boolean; inserted: number };

export function ImportDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [csv, setCsv] = useState(CSV_TEMPLATE);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(commit: boolean) {
    setBusy(true);
    try {
      const p = await api<Preview>("/inquiries/import", { body: { csv, commit } });
      setPreview(p);
      if (p.committed) {
        toast.success(`Imported ${p.inserted} synthetic inquiries (${p.duplicates} duplicates skipped)`);
        onDone();
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { onOpenChange(o); if (!o) setPreview(null); }}
      wide
      title="Import demo CSV"
      description="Synthetic rows only. Preview validates every line; import is idempotent on external_id and never overwrites."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={() => run(false)} loading={busy}>Preview</Button>
          <Button variant="primary" onClick={() => run(true)} disabled={!preview || preview.errors.length > 0 || preview.newRows === 0 || preview.committed} loading={busy}>Import {preview?.newRows ?? 0} rows</Button>
        </>
      }
    >
      <Label htmlFor="csv">Paste CSV (file attachments are not accepted in demo mode)</Label>
      <Textarea id="csv" rows={8} className="font-mono text-[12px]" value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); }} spellCheck={false} />
      {preview && (
        <div className="mt-4 space-y-2 text-[13px]">
          <div className="flex flex-wrap gap-4">
            <span><strong>{preview.validRows}</strong> valid</span>
            <span><strong>{preview.newRows}</strong> new</span>
            <span><strong>{preview.duplicates}</strong> already imported</span>
            <span className={preview.errors.length ? "text-bad" : ""}><strong>{preview.errors.length}</strong> errors</span>
          </div>
          {preview.errors.length > 0 && (
            <ul className="max-h-40 overflow-y-auto rounded-md border border-bad/30 bg-bad-soft p-2 text-[12px] text-bad">
              {preview.errors.map((e, i) => <li key={i}>Line {e.line}{e.column ? ` · ${e.column}` : ""}: {e.message}</li>)}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  );
}
