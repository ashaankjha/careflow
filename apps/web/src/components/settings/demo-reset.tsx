"use client";
import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { api, ApiError } from "@/lib/client/api";

export function DemoReset() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)} data-testid="demo-reset"><RotateCcw className="h-4 w-4" />Reset demo to seed state</Button>
      <Dialog open={open} onOpenChange={setOpen} title="Reset demo data?" description="Deletes all demo inquiries, events, missions, drafts, experiments and audit history, then restores the deterministic seed. Users stay signed in."
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} data-testid="confirm-reset" onClick={async () => {
          setBusy(true);
          try {
            const r = await api<{ inquiries: number; events: number; missions: number }>("/demo/reset", { body: {} });
            toast.success(`Demo reset: ${r.inquiries} inquiries, ${r.events} events, ${r.missions} missions`);
            setOpen(false);
            router.refresh();
          } catch (e) {
            toast.error(e instanceof ApiError ? e.message : "Reset failed");
          } finally {
            setBusy(false);
          }
        }}>Reset now</Button></>}>
        <p className="text-[13px] text-ink-2">This is only available for demo organizations.</p>
      </Dialog>
    </>
  );
}
