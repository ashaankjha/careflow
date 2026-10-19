import { assignOwner } from "@careflow/db";
import { z } from "zod";
import { route, readJson } from "@/lib/server/api";
import { db } from "@/lib/server/db";

const schema = z.object({ ownerId: z.string().uuid().nullable() });
export const POST = route("inquiry:transition", async ({ ctx, req, params }) => assignOwner(db(), ctx, params.id!, schema.parse(await readJson(req)).ownerId));
