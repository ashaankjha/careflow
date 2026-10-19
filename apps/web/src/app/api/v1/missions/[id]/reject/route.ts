import { rejectMission } from "@careflow/db";
import { z } from "zod";
import { route, readJson } from "@/lib/server/api";
import { db } from "@/lib/server/db";

const schema = z.object({ note: z.string().trim().max(280).optional() });
export const POST = route("mission:approve", async ({ ctx, req, params }) => rejectMission(db(), ctx, params.id!, schema.parse(await readJson(req)).note));
