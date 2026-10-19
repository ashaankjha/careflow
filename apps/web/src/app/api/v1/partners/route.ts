import { createPartner, listPartners } from "@careflow/db";
import { route, readJson } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route("partner:read", async ({ ctx }) => listPartners(db(), ctx));
export const POST = route("partner:manage", async ({ ctx, req }) => Response.json(await createPartner(db(), ctx, (await readJson(req)) as never), { status: 201 }));
