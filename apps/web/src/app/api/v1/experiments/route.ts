import { createExperiment, listExperiments } from "@careflow/db";
import { route, readJson } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route("experiment:read", async ({ ctx }) => listExperiments(db(), ctx));
export const POST = route("experiment:manage", async ({ ctx, req }) => Response.json(await createExperiment(db(), ctx, (await readJson(req)) as never), { status: 201 }));
