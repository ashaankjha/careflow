"use client";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto mt-16 max-w-md rounded-xl border border-bad/30 bg-surface p-6 text-center shadow-card">
      <AlertTriangle className="mx-auto h-6 w-6 text-bad" aria-hidden />
      <h2 className="mt-3 text-base font-semibold">This view could not be loaded</h2>
      <p className="mt-1 text-[13px] text-ink-3">
        The database may be unavailable or your session may have expired. No data was changed.
        {error.digest && <span className="block font-mono text-[11px] text-ink-4">Reference {error.digest}</span>}
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <Button variant="primary" onClick={reset}><RefreshCw className="h-4 w-4" />Retry</Button>
        <a href="/login" className="inline-flex h-9 items-center rounded-md border border-line px-4 text-sm font-medium hover:bg-canvas">Sign in again</a>
      </div>
    </div>
  );
}
