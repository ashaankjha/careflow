import { ACTIONS, can, ROLE_LABELS, ROLES, SERVICE_MODE_LABELS, type ServiceMode } from "@careflow/core";
import { getPolicy, listAudit, listCenters, listSources, listUsers } from "@careflow/db";
import { Badge, SyntheticBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { DemoReset } from "@/components/settings/demo-reset";
import { db } from "@/lib/server/db";
import { requireSession } from "@/lib/server/session";
import { fmtDateTime, titleCase } from "@/lib/format";
import { METRIC_DEFS } from "@/lib/metric-defs";

export const metadata = { title: "Settings" };

const INTEGRATIONS = [
  { name: "US Census ACS 2024 5-year", status: process.env.CENSUS_API_KEY ? "configured" : "fixture", note: "Optional public refresh (CENSUS_API_KEY + ACS_ZCTAS); synthetic fixture otherwise" },
  { name: "CMS NPPES listings", status: "fixture", note: "Synthetic prefiltered fixture; live ingestion is Phase 2" },
  { name: "AI narrative drafting", status: process.env.LLM_ENABLED === "true" ? "enabled" : "disabled", note: "Deterministic templates by default; payload allowlist excludes all family data" },
  { name: "Email / SMS delivery", status: "disabled", note: "DeliveryProvider.send throws FeatureDisabled in the MVP" },
  { name: "EHR / CRM intake sync", status: "disabled", note: "IntakeConnector disabled until compliant production integration" },
  { name: "CMS / website publishing", status: "disabled", note: "Local preview only; no auto-publishing" },
  { name: "Ad platforms & tracking pixels", status: "disabled", note: "Never loaded on intake surfaces (CSP blocks third-party scripts)" },
];

export default async function SettingsPage() {
  const s = await requireSession();
  const role = s.user.role;
  const [policy, centers, users, sources, audit] = await Promise.all([
    getPolicy(db(), s.ctx),
    listCenters(db(), s.ctx),
    listUsers(db(), s.ctx),
    listSources(db(), s.ctx),
    can(role, "audit:read") ? listAudit(db(), s.ctx, 60) : Promise.resolve(null),
  ]);
  const tz = s.org.timezone;
  return (
    <>
      <PageHeader eyebrow={<span className="flex items-center gap-2">{s.org.name} <SyntheticBadge /></span>} title="Settings" description="Tenant configuration, roles, integrations, provenance, definitions and audit history." />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Demo data" description="Restore the exact deterministic seed state (same IDs, counts and relative timings)." />
          <CardBody>
            {can(role, "demo:reset") ? <DemoReset /> : <p className="text-[13px] text-ink-3">Only administrators can reset demo data.</p>}
            <p className="mt-3 text-[12px] text-ink-3">CLI equivalent: <code className="rounded bg-canvas px-1">pnpm db:reset</code></p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Integrations" description="All optional; the demo runs fully offline." />
          <CardBody className="space-y-2">
            {INTEGRATIONS.map((i) => (
              <div key={i.name} className="flex items-start justify-between gap-3 text-[12.5px]">
                <div><div className="font-medium">{i.name}</div><div className="text-[11.5px] text-ink-3">{i.note}</div></div>
                <Badge tone={i.status === "disabled" ? "neutral" : i.status === "fixture" ? "warn" : "good"}>{i.status}</Badge>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Sites" description="Fictional configuration; addresses placed in a non-real demo geography." />
          <CardBody className="space-y-2 text-[12.5px]">
            {centers.map((c) => (
              <div key={c.id} className="flex justify-between gap-3 border-b border-line/70 pb-2 last:border-0">
                <div><div className="font-medium">{c.name}</div><div className="text-ink-3">{c.addressLine}, {c.city} · {c.serviceRadiusMiles} mi radius</div></div>
                <div className="text-right text-ink-3">{c.serviceModes.map((m) => SERVICE_MODE_LABELS[m as ServiceMode]).join(", ")}<div>public profile: {c.publicProfileStatus}</div></div>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Tenant policy" description="Thresholds cited in metrics and mission evidence." />
          <CardBody>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12.5px]">
              <dt className="text-ink-3">First-response SLA</dt><dd className="font-medium">{policy.firstResponseSlaHours} h</dd>
              <dt className="text-ink-3">Payer verification max age</dt><dd className="font-medium">{policy.payerVerificationMaxAgeDays} d</dd>
              <dt className="text-ink-3">Capacity verification max age</dt><dd className="font-medium">{policy.capacityVerificationMaxAgeDays} d</dd>
              <dt className="text-ink-3">Planning default hours</dt><dd className="font-medium">{policy.planningDefaultDirectHours} h/wk</dd>
              <dt className="text-ink-3">Minimum cell size</dt><dd className="font-medium">{policy.minCellSize}</dd>
              <dt className="text-ink-3">Experiment min N per arm</dt><dd className="font-medium">{policy.experimentMinSamplePerArm}</dd>
              <dt className="text-ink-3">M2 verified-hours threshold</dt><dd className="font-medium">{policy.missions.m2MinVerifiedHours} h/wk</dd>
              <dt className="text-ink-3">Stall thresholds</dt><dd className="font-medium">{Object.entries(policy.stallThresholdDays).map(([k, v]) => `${k} ${v}d`).join(", ")}</dd>
            </dl>
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Users & role permissions" description="Enforced server-side on every API route; the UI only mirrors it." />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[12px]" data-testid="rbac-matrix">
              <thead><tr className="border-b border-line text-left text-ink-3"><th className="px-5 py-2 font-medium">Action</th>{ROLES.map((r) => <th key={r} className="px-2 py-2 text-center font-medium">{titleCase(r)}</th>)}</tr></thead>
              <tbody>
                {ACTIONS.map((a) => (
                  <tr key={a} className="border-b border-line/60 last:border-0"><td className="px-5 py-1 font-mono text-[11px]">{a}</td>{ROLES.map((r) => <td key={r} className="px-2 py-1 text-center">{can(r, a) ? <span className="text-good">●</span> : <span className="text-ink-4">·</span>}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <CardBody className="flex flex-wrap gap-2 border-t border-line">
            {users.map((u) => <Badge key={u.id} tone="outline">{u.displayName} · {ROLE_LABELS[u.role]}</Badge>)}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Metric definitions" />
          <CardBody className="space-y-3">
            {Object.entries(METRIC_DEFS).map(([k, d]) => (
              <div key={k} className="text-[12.5px]"><div className="font-medium">{d.label} <span className="font-mono text-[11px] text-ink-4">{k}</span></div><div className="text-ink-2">{d.definition}</div>{d.caveat && <div className="text-ink-3">{d.caveat}</div>}</div>
            ))}
          </CardBody>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Provenance log" description="Source snapshots and refresh runs." />
            <CardBody className="max-h-80 space-y-1 overflow-y-auto">
              {sources.map((x) => (
                <div key={x.id} className="flex items-center justify-between gap-2 text-[12px]"><span className="truncate">{x.sourceKey}</span><span className="flex items-center gap-1.5"><Badge tone={x.status === "ok" ? "good" : x.status === "failed" ? "bad" : "neutral"}>{x.status}</Badge><span className="text-ink-4">{fmtDateTime(x.ingestedAt, tz)}</span></span></div>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Audit history" description="Append-only; reads, exports, changes and denied attempts. No request bodies." />
            <CardBody className="max-h-96 overflow-y-auto">
              {audit ? (
                <table className="w-full text-[11.5px]" data-testid="audit-log">
                  <tbody>
                    {audit.map((a) => (
                      <tr key={a.id} className="border-b border-line/60 last:border-0">
                        <td className="py-1 pr-2 text-ink-4">{fmtDateTime(a.eventTime, tz)}</td>
                        <td className="py-1 pr-2 font-mono">{a.action}</td>
                        <td className="py-1 pr-2 text-ink-3">{a.actorRole}</td>
                        <td className="py-1 text-right">{a.allowed ? <span className="text-good">allowed</span> : <span className="text-bad">denied</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="text-[12.5px] text-ink-3">Audit history is visible to administrators and operations.</p>}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
