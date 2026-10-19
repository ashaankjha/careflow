"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Dialog({ open, onOpenChange, title, description, children, footer, wide }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[1px] animate-fade-in" />
        <D.Content
          className={cn(
            "fixed left-1/2 top-[6vh] z-50 flex max-h-[88vh] w-[calc(100vw-2rem)] -translate-x-1/2 flex-col rounded-xl border border-line bg-surface shadow-pop animate-fade-in",
            wide ? "max-w-3xl" : "max-w-lg",
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <D.Title className="text-[15px] font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-0.5 text-[13px] text-ink-3">{description}</D.Description> : <D.Description className="sr-only">Dialog</D.Description>}
            </div>
            <D.Close className="rounded-md p-1 text-ink-3 hover:bg-ink/5" aria-label="Close"><X className="h-4 w-4" /></D.Close>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function Sheet({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-ink/25 animate-fade-in" />
        <D.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-line bg-canvas shadow-pop animate-slide-in">
          <div className="flex items-start justify-between gap-4 border-b border-line bg-surface px-6 py-4">
            <div className="min-w-0">
              <D.Title className="truncate text-base font-semibold">{title}</D.Title>
              {description ? <D.Description asChild><div className="mt-1 text-[13px] text-ink-3">{description}</div></D.Description> : <D.Description className="sr-only">Details</D.Description>}
            </div>
            <D.Close className="rounded-md p-1 text-ink-3 hover:bg-ink/5" aria-label="Close panel"><X className="h-4 w-4" /></D.Close>
          </div>
          <div className="flex-1 overflow-y-auto">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
