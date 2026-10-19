"use client";
import * as T from "@radix-ui/react-tabs";
import { cn } from "@/lib/cn";

export const Tabs = T.Root;
export const TabsContent = T.Content;

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
