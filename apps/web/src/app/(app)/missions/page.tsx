import { can } from "@careflow/core";
import { listMissions, listPartners } from "@careflow/db";
import { SyntheticBadge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/misc";
import { MissionsWorkspace } from "@/components/missions/workspace";
import { db, withOrg } from "@/lib/server/db";
import { requireSession } from "@/lib/server/session";

export const metadata = { title: "Growth Missions" };

export default async function MissionsPage() {
  const s = await requireSession();
  const [missions, partners] = await withOrg(s.ctx, () => Promise.all([listMissions(db(), s.ctx), listPartners(db(), s.ctx)]));
  const r = s.user.role;
  return (
    <>
      <PageHeader
        eyebrow={<span className="flex items-center gap-2">Growth engineering <SyntheticBadge label="Synthetic evidence" /></span>}
        title="Growth missions"
        description="Deterministic rules turn saved metrics into proposed interventions. AI never changes evidence or triggers execution; every outward artifact waits for human approval and nothing is ever sent or published automatically."
      />
      <MissionsWorkspace
        missions={JSON.parse(JSON.stringify(missions))}
        partners={partners.filter((p) => p.relationshipStatus !== "paused").map((p) => ({ id: p.id, name: p.businessName }))}
        perms={{
          generate: can(r, "mission:generate"),
          approve: can(r, "mission:approve"),
          approveOps: can(r, "mission:approve_ops_gated"),
          status: can(r, "mission:status"),
          draft: can(r, "draft:generate"),
          edit: can(r, "draft:edit"),
          approveDraft: can(r, "draft:approve"),
          export: can(r, "draft:export"),
          experiment: can(r, "experiment:manage"),
        }}
        tz={s.org.timezone}
      />
    </>
  );
}
