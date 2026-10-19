import { listMissions } from "@careflow/db";
import { route, searchParams } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route("mission:read", async ({ ctx, req }) => listMissions(db(), ctx, { status: searchParams(req).get("status") ?? undefined, centerId: searchParams(req).get("centerId") ?? undefined }));
