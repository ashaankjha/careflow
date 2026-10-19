import { releaseHold, releaseHoldSchema } from "@careflow/db";
import { route, readJson } from "@/lib/server/api";
import { db } from "@/lib/server/db";

/** Release a capacity hold (idempotent). */
export const POST = route("hold:release", async ({ ctx, req, params }) => releaseHold(db(), ctx, params.id!, releaseHoldSchema.parse(await readJson(req))));
