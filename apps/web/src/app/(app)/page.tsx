import { getDashboard, listCenters, listMissions } from "@careflow/db";
import { STAGE_LABELS, SOURCE_LABELS, type SourceChannel, type Stage } from "@careflow/core";
import { AlertTriangle, ArrowRight, Database, Download, Target } from "lucide-react";
import Link from "next/link";
import { Badge, SyntheticBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, Meter, PageHeader } from "@/components/ui/misc";
import { InfoTip } from "@/components/ui/tooltip";
import { FilterBar } from "@/components/filter-bar";
import { KpiCard } from "@/components/overview/kpi-card";
import { TrendChart } from "@/components/overview/trend-chart";
import { Funnel } from "@/components/overview/funnel";
import { db, withOrg } from "@/lib/server/db";
import { requireSession } from "@/lib/server/session";
import { parseDashboardFilters } from "@/lib/filters";
import { fmtDate, fmtDateTime, fmtNum, fmtPct, relativeDays } from "@/lib/format";
import { METRIC_DEFS } from "@/lib/metric-defs";

export const metadata = { title: "Overview" };

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const s = await requireSession();
  const filters = parseDashboardFilters(await searchParams);
  const [d, centers, missions] = await withOrg(s.ctx, () => Promise.all([getDashboard(db(), s.ctx, filters), listCenters(db(), s.ctx), listMissions(db(), s.ctx, { status: "proposed" })]));
  const k = d.kpis;
  const tz = s.org.timezone;
  const exportHref = `/api/v1/inquiries/export?${new URLSearchParams(Object.entries({ range: String(filters.rangeDays), centerId: filters.centerId ?? "", source: filters.source ?? "" }).filter(([, v]) => v)).toString()}`;

  return (
    <>
      <PageHeader
        eyebrow={<span className="flex items-center gap-2">{s.org.name} <SyntheticBadge /></span>}
        title="Growth overview"
        description="Every number below is computed from the immutable intake event log and current verified capacity — nothing is hard-coded. Hover the info icons for definitions, numerators and denominators."
        actions={
          <>
            <FilterBar centers={centers.map((c) => ({ id: c.id, name: c.name }))} />
            <a href={exportHref} className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-medium hover:bg-canvas">
              <Download className="h-4 w-4" aria-hidden /> Aggregate CSV
            </a>
          </>
        }
      />

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard testId="kpi-care-starts" metric="care_starts" value={fmtNum(k.care_starts.value)} ratio={`${k.inquiries_created.value} inquiries created`} sub={`${fmtDate(d.filters.from, tz)} – ${fmtDate(d.filters.to, tz)}`} />
        <KpiCard
          testId="kpi-start-rate"
          metric="cohort_start_rate"
          value={fmtPct(k.cohort_start_rate.value)}
          ratio={`${k.cohort_start_rate.numerator} / ${k.cohort_start_rate.denominator}`}
          sub={<>Cutoff {fmtDate(k.cohort_start_rate.cutoff, tz)} · {k.cohort_start_rate.censoredYoung} &lt;45 d old (censored)</>}
        />
        <KpiCard
          testId="kpi-first-response"
          metric="median_first_response_hours"
          value={k.median_first_response_hours.value == null ? "—" : `${fmtNum(k.median_first_response_hours.value, 1)} h`}
          ratio={`${k.median_first_response_hours.withinSla}/${k.median_first_response_hours.slaDenominator} within ${k.median_first_response_hours.slaHours}h SLA`}
          sub={`${k.median_first_response_hours.unanswered} not yet contacted`}
        />
        <KpiCard testId="kpi-days-to-start" metric="median_days_to_start" value={k.median_days_to_start.value == null ? "—" : `${fmtNum(k.median_days_to_start.value, 0)} d`} ratio={`n = ${k.median_days_to_start.n} starts`} />
        <KpiCard
          testId="kpi-capacity-fit"
          metric="capacity_fit_rate"
          value={fmtPct(k.capacity_fit_rate.value)}
          ratio={`${k.capacity_fit_rate.numerator} / ${k.capacity_fit_rate.denominator}`}
          sub={`${k.capacity_fit_rate.missingInputs} missing required inputs`}
        />
        <KpiCard testId="kpi-stalls" metric="unresolved_stalls" value={fmtNum(k.unresolved_stalls.value)} ratio={`${k.unresolved_stalls.numerator} / ${k.unresolved_stalls.denominator} active`} sub="Current snapshot" />
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader title="Site demand vs. verified capacity" description="Bottlenecks are flagged from computed metrics and tenant thresholds." actions={<InfoTip content={METRIC_DEFS.verified_weekly_direct_hours_available!.definition} />} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]" data-testid="site-matrix">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-ink-3">
                  <th className="px-5 py-2.5 font-medium">Site</th>
                  <th className="px-3 py-2.5 text-right font-medium">Inquiries</th>
                  <th className="px-3 py-2.5 font-medium">No verified fit at site</th>
                  <th className="px-3 py-2.5 text-right font-medium">Verified h/wk</th>
                  <th className="px-3 py-2.5 text-right font-medium">Starts</th>
                  <th className="px-3 py-2.5 text-right font-medium">Stalls</th>
                </tr>
              </thead>
              <tbody>
                {d.siteMatrix.map((r) => (
                  <tr key={r.centerId} className="border-b border-line/70 align-top last:border-0" data-testid={`site-row-${r.centerName.split(" ")[0]!.toLowerCase()}`}>
                    <td className="px-5 py-3">
                      <div className="font-medium">{r.centerName}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {r.flags.map((f) => (
                          <Badge key={f.key} tone={f.tone === "red" ? "bad" : f.tone === "amber" ? "warn" : "blue"}>
                            {f.tone !== "blue" && <AlertTriangle className="h-3 w-3" aria-hidden />}
                            {f.label}
                          </Badge>
                        ))}
                        {r.flags.length === 0 && <span className="text-[12px] text-ink-4">No flags</span>}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular">{r.inquiries}</td>
                    <td className="w-40 px-3 py-3">
                      <div className="mb-1 flex justify-between text-[12px] tabular"><span>{fmtPct(r.notFeasibleShare)}</span><span className="text-ink-4">{r.notFeasibleAtSite}/{r.evaluated}</span></div>
                      <Meter value={r.notFeasibleShare} tone={(r.notFeasibleShare ?? 0) > 0.5 ? "bad" : (r.notFeasibleShare ?? 0) > 0.25 ? "warn" : "good"} label={`${r.centerName} share with no verified fit`} />
                    </td>
                    <td className="min-w-[150px] px-3 py-3 text-right" data-testid={`verified-hours-${r.centerName.split(" ")[0]!.toLowerCase()}`}>
                      <div className="font-medium tabular">{r.verifiedHours ?? "unverified"}</div>
                      <div className="text-[11px] text-ink-3">{r.capacityReason}</div>
                    </td>
                    <td className="px-3 py-3 text-right tabular">{r.starts}</td>
                    <td className="px-3 py-3 text-right tabular">
                      {r.stalled}
                      {r.benefitsStalled > 0 && <div className="text-[11px] text-warn">{r.benefitsStalled} in benefits</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Top recommended missions"
            description="Generated by deterministic rules from saved metrics."
            actions={<Link href="/missions" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">All missions <ArrowRight className="h-3.5 w-3.5" /></Link>}
          />
          <CardBody className="space-y-3">
            {missions.slice(0, 3).map((m) => (
              <Link key={m.id} href={`/missions#${m.id}`} className="block rounded-lg border border-line p-3 transition-colors hover:border-accent/40 hover:bg-accent-soft/30">
                <div className="flex items-center gap-2">
                  <Badge tone="ink">{m.ruleId}</Badge>
                  <Badge tone="outline">{m.category}</Badge>
                  {m.requiresOpsReview && <Badge tone="warn">Ops sign-off</Badge>}
                </div>
                <div className="mt-2 text-[13.5px] font-medium leading-5">{m.title}</div>
                <div className="mt-1 line-clamp-2 text-[12.5px] text-ink-3">{m.explanation}</div>
              </Link>
            ))}
            {missions.length === 0 && (
              <EmptyState icon={<Target className="h-6 w-6" />} title="No proposed missions">Run mission generation from Growth Missions after data changes.</EmptyState>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader title="Weekly trend" description="Inquiries created and first verified care starts per week (organization time zone)." actions={<SyntheticBadge label="Synthetic events" />} />
          <CardBody>
            <TrendChart data={d.trend} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Stage drop-off" description="Creation cohort in window: distinct inquiries that ever reached each stage." />
          <CardBody>
            <Funnel data={d.funnel} />
            <p className="mt-3 text-[11.5px] text-ink-3">Recent inquiries are still progressing (right-censored); compare cohorts of similar age.</p>
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Stalls by stage" description="Active inquiries over the configured age threshold." />
          <CardBody className="space-y-2">
            {d.stallByStage.map((st) => (
              <div key={st.stage} className="grid grid-cols-[1fr_60px_70px] items-center gap-2 text-[12.5px]">
                <Link href={`/intake?stage=${st.stage}`} className="truncate text-ink-2 hover:text-accent">{STAGE_LABELS[st.stage as Stage]}</Link>
                <span className="text-right text-ink-3 tabular">&gt;{st.thresholdDays} d</span>
                <span className="text-right tabular"><span className={st.stalled ? "font-semibold text-warn" : ""}>{st.stalled}</span><span className="text-ink-4"> / {st.active}</span></span>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Referral source attribution" description="First-party codes, single-touch. Unattributed is always counted." actions={<InfoTip content={METRIC_DEFS.referral_source_attribution!.caveat} />} />
          <CardBody>
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-ink-3"><th className="pb-2 font-medium">Source</th><th className="pb-2 text-right font-medium">Inquiries</th><th className="pb-2 text-right font-medium">Starts</th></tr></thead>
              <tbody>
                {d.attribution.codes.slice(0, 6).map((c) => (
                  <tr key={c.code} className="border-t border-line/70"><td className="py-1.5"><span className="font-mono text-[11px] text-ink-3">{c.code}</span> <span className="text-ink-2">{c.partner.replace(" (DEMO)", "")}</span></td><td className="py-1.5 text-right tabular">{c.inquiries}</td><td className="py-1.5 text-right tabular">{c.starts}</td></tr>
                ))}
                <tr className="border-t border-line/70" data-testid="unattributed-row"><td className="py-1.5 font-medium text-ink-2">Unattributed <Badge tone="neutral">flagged</Badge></td><td className="py-1.5 text-right tabular">{d.attribution.unattributed.inquiries}</td><td className="py-1.5 text-right tabular">{d.attribution.unattributed.starts}</td></tr>
              </tbody>
            </table>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {d.attribution.channels.map((c) => <Badge key={c.channel} tone="outline">{SOURCE_LABELS[c.channel as SourceChannel] ?? c.channel}: {c.inquiries}</Badge>)}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Data freshness & provenance" actions={<Database className="h-4 w-4 text-ink-4" aria-hidden />} />
          <CardBody className="space-y-2 text-[12.5px]">
            <div className="flex justify-between"><span className="text-ink-3">Last intake event recorded</span><span className="font-medium">{fmtDateTime(d.provenance.lastEventRecordedAt, tz)}</span></div>
            <div className="flex justify-between"><span className="text-ink-3">Capacity evaluated</span><span className="font-medium">{fmtDateTime(d.provenance.capacityEvaluatedAt, tz)}</span></div>
            <div className="border-t border-line pt-2">
              {d.provenance.sources.map((src) => (
                <div key={src.sourceKey} className="flex items-center justify-between gap-2 py-1">
                  <span className="truncate text-ink-2">{src.sourceKey}</span>
                  <span className="flex items-center gap-1.5">
                    {src.demoFixture && <SyntheticBadge label="Fixture" />}
                    <Badge tone={src.status === "ok" ? "good" : src.status === "failed" ? "bad" : "neutral"}>{src.status}</Badge>
                    <span className="text-ink-3">{relativeDays(src.ingestedAt)}</span>
                  </span>
                </div>
              ))}
            </div>
            <Link href="/market" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline">Market sources <ArrowRight className="h-3 w-3" /></Link>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
