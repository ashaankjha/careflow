"use client";
import * as T from "@radix-ui/react-tabs";
import { cn } from "@/lib/cn";

export const Tabs = T.Root;

/**
 * Inactive panels stay mounted (hidden) so every trigger's aria-controls
 * points at an element in the DOM (axe aria-valid-attr-value).
 */
export function TabsContent({ className, ...p }: T.TabsContentProps) {
  return <T.Content forceMount className={cn("data-[state=inactive]:hidden", className)} {...p} />;
}

export function TabsList({ className, ...p }: T.TabsListProps) {
  return <T.List className={cn("inline-flex items-center gap-1 rounded-lg border border-line bg-surface p-1", className)} {...p} />;
}

export function TabsTrigger({ className, ...p }: T.TabsTriggerProps) {
  return (
    <T.Trigger
      className={cn("rounded-md px-3 py-1.5 text-[13px] font-medium text-ink-3 transition-colors hover:text-ink data-[state=active]:bg-ink data-[state=active]:text-white", className)}
      {...p}
    />
  );
}
