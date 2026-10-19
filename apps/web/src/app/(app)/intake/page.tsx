import { listCenters, listInquiries, listIntakeOwners, listPayers, marketZctas } from "@careflow/db";
import { can } from "@careflow/core";
import { db } from "@/lib/server/db";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/misc";
import { SyntheticBadge } from "@/components/ui/badge";
import { IntakeWorkspace } from "@/components/intake/workspace";

export const metadata = { title: "Intake Funnel" };

export default async function IntakePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const filters = {
    stage: (sp.stage as never) || undefined,
    centerId: sp.centerId || undefined,
    source: sp.source || undefined,
    ownerId: sp.owner === "me" ? s.user.id : sp.owner === "unassigned" ? "unassigned" : undefined,
    q: sp.q?.slice(0, 60) || undefined,
    page: Number(sp.page ?? 1) || 1,
    pageSize: 25,
  };
  const [list, board, centers, payers, owners, market] = await Promise.all([
    listInquiries(db(), s.ctx, filters),
    listInquiries(db(), s.ctx, { ...filters, page: 1, pageSize: 200, stage: filters.stage ?? "active" }),
    listCenters(db(), s.ctx),
    listPayers(db(), s.ctx),
    listIntakeOwners(db(), s.ctx),
    marketZctas(db(), s.ctx),
  ]);
  return (
    <>
      <PageHeader
        eyebrow={<span className="flex items-center gap-2">Intake <SyntheticBadge /></span>}
        title="Intake funnel"
        description="Administrative stages only — no diagnosis, clinical severity or records. Every quick action writes an immutable, idempotent event."
      />
      <IntakeWorkspace
        list={JSON.parse(JSON.stringify(list))}
        board={JSON.parse(JSON.stringify(board.items))}
        centers={centers.map((c) => ({ id: c.id, name: c.name }))}
        payers={payers.map((p) => ({ id: p.id, name: p.name }))}
        owners={owners}
        zctas={market.zctas.filter((z) => z.demoFixture).map((z) => ({ zcta5: z.zcta5, label: z.label }))}
        perms={{ create: can(s.user.role, "inquiry:create"), transition: can(s.user.role, "inquiry:transition"), import: can(s.user.role, "inquiry:import"), persist: can(s.user.role, "matching:persist") }}
        tz={s.org.timezone}
        initialInquiryId={sp.inquiry ?? null}
      />
    </>
  );
}
