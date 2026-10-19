import { completeExperiment } from "@careflow/db";
import { z } from "zod";
import { route, readJson } from "@/lib/server/api";
import { db } from "@/lib/server/db";

const schema = z.object({ notes: z.string().trim().max(1000).optional() });
export const POST = route("experiment:manage", async ({ ctx, req, params }) => completeExperiment(db(), ctx, params.id!, schema.parse(await readJson(req)).notes));
