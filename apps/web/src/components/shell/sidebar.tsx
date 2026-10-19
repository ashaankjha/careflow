"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, FlaskConical, Gauge, Handshake, LayoutDashboard, Map, Settings, Target, Menu, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Logo } from "./logo";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/intake", label: "Intake Funnel", icon: BarChart3 },
  { href: "/capacity", label: "Capacity & Matching", icon: Gauge },
  { href: "/market", label: "Market Map", icon: Map },
  { href: "/missions", label: "Growth Missions", icon: Target },
  { href: "/experiments", label: "Experiments", icon: FlaskConical },
  { href: "/referrals", label: "Referral Network", icon: Handshake },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Primary" className="space-y-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] font-medium transition-colors",
              active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar({ orgName }: { orgName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-ink px-3 py-4 lg:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <Logo />
          <div className="min-w-0">
            <div className="text-[14px] font-semibold tracking-tight text-white">CareFlow AI</div>
            <div className="truncate text-[11px] text-white/50">{orgName}</div>
          </div>
        </div>
        <NavList />
        <div className="mt-auto rounded-lg border border-white/10 bg-white/[0.03] p-3 text-[11px] leading-4 text-white/55">
          <div className="mb-1 font-semibold text-white/80">Sandbox mode</div>
          Synthetic data only. Sending, publishing and live integrations are disabled.
        </div>
      </aside>
      <div className="no-print sticky top-0 z-30 flex items-center justify-between bg-ink px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2"><Logo className="h-6 w-6" /><span className="text-sm font-semibold text-white">CareFlow AI</span></div>
        <button aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((o) => !o)} className="rounded p-1 text-white">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <div className="no-print fixed inset-x-0 top-[52px] z-30 bg-ink px-3 pb-4 lg:hidden">
          <NavList onNavigate={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}
