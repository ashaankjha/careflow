import { can } from "@careflow/core";
import { capacitySummaries, getCenterCapacity, listCenters, listPayers, marketZctas } from "@careflow/db";
import { SyntheticBadge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/misc";
import { CapacityWorkspace } from "@/components/capacity/workspace";
import { db } from "@/lib/server/db";
import { requireSession } from "@/lib/server/session";

export const metadata = { title: "Capacity & Matching" };

export default async function CapacityPage() {
  const s = await requireSession();
  const [centers, payers, caps, market] = await Promise.all([listCenters(db(), s.ctx), listPayers(db(), s.ctx), capacitySummaries(db(), s.ctx), marketZctas(db(), s.ctx)]);
  const sheets = await Promise.all(centers.map((c) => getCenterCapacity(db(), s.ctx, c.id)));
  const data = JSON.parse(JSON.stringify(sheets.map((sh) => ({ ...sh, summary: caps.find((c) => c.centerId === sh.center.id) }))));
  return (
    <>
      <PageHeader
        eyebrow={<span className="flex items-center gap-2">Operations <SyntheticBadge /></span>}
        title="Capacity & matching"
        description="Operations publishes verified payer participation and staff availability. The matcher uses only verified, fresh data and explains every hard gate. It never books appointments or determines insurance eligibility."
      />
      <CapacityWorkspace
        sheets={data}
        payers={payers.map((p) => ({ id: p.id, name: p.name }))}
        zctas={market.zctas.filter((z) => z.demoFixture).map((z) => ({ zcta5: z.zcta5, label: z.label }))}
        canEdit={can(s.user.role, "capacity:edit")}
        canEditPayers={can(s.user.role, "payer:edit")}
      />
    </>
  );
}
