import { listAudit } from "@careflow/db";
import { route, searchParams } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route("audit:read", async ({ ctx, req }) => listAudit(db(), ctx, Number(searchParams(req).get("limit") ?? 100)));
