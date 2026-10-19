import { can } from "@careflow/core";
import { listCenters, listExperiments } from "@careflow/db";
import { SyntheticBadge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EquityPanel } from "@/components/experiments/equity-panel";
import { ExperimentsWorkspace } from "@/components/experiments/workspace";
import { db, withOrg } from "@/lib/server/db";
import { requireSession } from "@/lib/server/session";

export const metadata = { title: "Experiments" };

export default async function ExperimentsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const [exps, centers] = await withOrg(s.ctx, () => Promise.all([listExperiments(db(), s.ctx), listCenters(db(), s.ctx)]));
  const centerOptions = centers.map((c) => ({ id: c.id, name: c.name }));
  const canEquity = can(s.user.role, "equity:read");
  const workspace = <ExperimentsWorkspace experiments={JSON.parse(JSON.stringify(exps))} centers={centerOptions} canManage={can(s.user.role, "experiment:manage")} initialId={sp.id ?? null} tz={s.org.timezone} />;
  return (
    <>
      <PageHeader
        eyebrow={<span className="flex items-center gap-2">Measurement <SyntheticBadge label="Simulated outcomes" /></span>}
        title="Experiments"
        description="Measure interventions on verified care starts, with denominators and uncertainty. Non-randomized comparisons are descriptive only; low-N results say “insufficient evidence”. No auto-stopping, no significance stars."
      />
      {canEquity ? (
        <Tabs defaultValue={sp.tab === "equity" ? "equity" : "experiments"}>
          <TabsList className="mb-4" aria-label="Measurement views">
            <TabsTrigger value="experiments" data-testid="tab-experiments">Experiments</TabsTrigger>
            <TabsTrigger value="equity" data-testid="tab-equity">Equity audit</TabsTrigger>
          </TabsList>
          <TabsContent value="experiments">{workspace}</TabsContent>
          <TabsContent value="equity"><EquityPanel centers={centerOptions} tz={s.org.timezone} /></TabsContent>
        </Tabs>
      ) : (
        workspace
      )}
    </>
  );
}
