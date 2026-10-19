"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";

const DEMO_USERS = [
  { email: "admin@harbor.demo", role: "Administrator", who: "Avery Chen" },
  { email: "growth@harbor.demo", role: "Growth director", who: "Riley Okafor" },
  { email: "ops@harbor.demo", role: "Operations director", who: "Sam Patel" },
  { email: "intake@harbor.demo", role: "Intake manager", who: "Jordan Lee" },
  { email: "viewer@harbor.demo", role: "Location manager (read-only)", who: "Casey Brooks" },
];
const DEMO_PASSWORD = "demo-pass-2026";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@harbor.demo");
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e?: React.FormEvent, as?: string) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api("/auth/login", { body: { email: as ?? email, password } });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed");
      setLoading(false);
    }
  }

  return (
    <>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p role="alert" className="rounded-md bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</p>}
        <Button type="submit" variant="primary" className="w-full justify-center" loading={loading}>Sign in</Button>
      </form>
      <div className="mt-8">
        <div className="eyebrow mb-2">Demo personas · password {DEMO_PASSWORD}</div>
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {DEMO_USERS.map((u) => (
            <li key={u.email}>
              <button type="button" onClick={() => { setEmail(u.email); void submit(undefined, u.email); }} className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-canvas" data-testid={`login-as-${u.email.split("@")[0]}`}>
                <span><span className="block text-[13px] font-medium">{u.role}</span><span className="text-[12px] text-ink-3">{u.who} · {u.email}</span></span>
                <span className="text-[12px] text-accent">Sign in →</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
