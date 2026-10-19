import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { LoginForm } from "./login-form";
import { Logo } from "@/components/shell/logo";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <Logo className="h-9 w-9" />
          <span className="text-lg font-semibold tracking-tight">CareFlow AI</span>
        </div>
        <div className="max-w-md">
          <p className="eyebrow !text-white/50">Capacity-aware growth OS</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight">More families starting care — sent where real, verified capacity exists.</h1>
          <p className="mt-4 text-[15px] leading-7 text-white/70">
            Connect intake events, operational capacity, local market signals and referral outreach into one evidence-backed loop. Every recommendation traces to saved metrics; every outward artifact waits for human approval.
          </p>
          <dl className="mt-10 grid grid-cols-3 gap-6 text-sm">
            {[["Matches", "Explainable hard gates"], ["Missions", "Rule-based, evidence-first"], ["Experiments", "Honest uncertainty"]].map(([k, v]) => (
              <div key={k}><dt className="font-semibold">{k}</dt><dd className="mt-1 text-white/60">{v}</dd></div>
            ))}
          </dl>
        </div>
        <p className="text-xs text-white/40">Synthetic demonstration · Not a HIPAA-compliant deployment · No real patient data</p>
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-teal/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-1/3 h-96 w-96 rounded-full bg-accent/30 blur-3xl" />
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden"><Logo /><span className="font-semibold">CareFlow AI</span></div>
          <h2 className="text-xl font-semibold tracking-tight">Sign in to the demo workspace</h2>
          <p className="mt-1 text-[13px] text-ink-3">Harbor Behavioral Services (DEMO) — fictional organization and synthetic data.</p>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
