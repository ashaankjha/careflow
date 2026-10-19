import { equityAudit } from "@careflow/db";
import { route, searchParams } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route("equity:read", async ({ ctx, req }) => {
  const p = searchParams(req);
  const days = p.get("days");
  return equityAudit(db(), ctx, { days: days ? Number(days) : undefined, centerId: p.get("centerId") || null });
});
