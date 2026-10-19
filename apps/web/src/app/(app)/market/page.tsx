import { can } from "@careflow/core";
import { listCenters, marketZctas } from "@careflow/db";
import { SyntheticBadge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/misc";
import { MarketWorkspace } from "@/components/market/workspace";
import { db } from "@/lib/server/db";
import { requireSession } from "@/lib/server/session";

export const metadata = { title: "Market Map" };

export default async function MarketPage() {
  const s = await requireSession();
  const [m, centers] = await Promise.all([marketZctas(db(), s.ctx), listCenters(db(), s.ctx)]);
  return (
    <>
      <PageHeader
        eyebrow={<span className="flex items-center gap-2">Market intelligence <SyntheticBadge label="Synthetic geography" /></span>}
        title="Market map"
        description="A transparent outreach-research heuristic over ZCTA-level public-data shapes and first-party aggregates. It ranks places to research — never individuals — and infers no diagnoses or prevalence."
      />
      <MarketWorkspace
        data={JSON.parse(JSON.stringify(m))}
        centers={centers.map((c) => ({ id: c.id, name: c.name, lat: c.latitude, lng: c.longitude, radius: c.serviceRadiusMiles }))}
        canRefresh={can(s.user.role, "market:refresh")}
        tz={s.org.timezone}
      />
    </>
  );
}
