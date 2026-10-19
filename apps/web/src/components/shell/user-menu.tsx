"use client";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";

export function UserMenu({ name, roleLabel }: { name: string; roleLabel: string }) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right sm:block">
        <div className="text-[13px] font-medium leading-4" data-testid="current-user">{name}</div>
        <div className="text-[11px] text-ink-3">{roleLabel}</div>
      </div>
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent-ink" aria-hidden>
        {name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Sign out"
        onClick={async () => {
          await api("/auth/logout", { body: {} });
          router.replace("/login");
          router.refresh();
        }}
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}
