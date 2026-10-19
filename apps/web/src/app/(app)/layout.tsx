import { ROLE_LABELS } from "@careflow/core";
import { ShieldAlert } from "lucide-react";
import { Sidebar } from "@/components/shell/sidebar";
import { UserMenu } from "@/components/shell/user-menu";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  return (
    <div className="min-h-screen">
      <Sidebar orgName={s.org.name} />
      <div className="lg:pl-60">
        <header className="no-print sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur lg:top-0">
          <div className="flex items-center justify-between gap-4 px-4 py-2.5 sm:px-8">
            <div className="flex min-w-0 items-center gap-2 text-[12px] text-warn" role="note">
              <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate"><strong className="font-semibold">Demo — synthetic data only.</strong> Do not enter real personal or health information.</span>
            </div>
            <UserMenu name={s.user.displayName} roleLabel={ROLE_LABELS[s.user.role]} />
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
