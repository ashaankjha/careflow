import { transitionInquiry } from "@careflow/db";
import { route, readJson } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const POST = route("inquiry:transition", async ({ ctx, req, params }) => transitionInquiry(db(), ctx, params.id!, (await readJson(req)) as never));
