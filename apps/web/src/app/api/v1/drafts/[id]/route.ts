import { getDraft, updateDraft } from "@careflow/db";
import { route, readJson } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route("mission:read", async ({ ctx, params }) => getDraft(db(), ctx, params.id!));
export const PUT = route("draft:edit", async ({ ctx, req, params }) => updateDraft(db(), ctx, params.id!, (await readJson(req)) as never));
