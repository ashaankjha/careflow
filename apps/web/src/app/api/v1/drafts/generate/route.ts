import { generateDraft } from "@careflow/db";
import { route, readJson } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const POST = route("draft:generate", async ({ ctx, req }) => Response.json(await generateDraft(db(), ctx, (await readJson(req)) as never), { status: 201 }));
