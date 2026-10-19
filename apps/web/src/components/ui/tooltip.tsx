"use client";
import * as T from "@radix-ui/react-tooltip";
import { Info } from "lucide-react";
import type { ReactNode } from "react";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <T.Provider delayDuration={150}>{children}</T.Provider>;
}

export function Tip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-50 max-w-xs rounded-lg bg-ink px-3 py-2 text-[12px] leading-5 text-white shadow-pop animate-fade-in">
          {content}
          <T.Arrow className="fill-ink" />
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

export function InfoTip({ content, label = "More information" }: { content: ReactNode; label?: string }) {
  return (
    <Tip content={content}>
      <button type="button" aria-label={label} className="inline-flex rounded text-ink-4 hover:text-ink-2">
        <Info className="h-3.5 w-3.5" />
      </button>
    </Tip>
  );
}
