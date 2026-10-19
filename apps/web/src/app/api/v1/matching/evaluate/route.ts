import { evaluateMatchRequest } from "@careflow/db";
import { route, readJson } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const POST = route("matching:evaluate", async ({ ctx, req }) => evaluateMatchRequest(db(), ctx, (await readJson(req)) as never));
