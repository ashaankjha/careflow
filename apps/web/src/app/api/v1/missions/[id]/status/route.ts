import { setMissionStatus } from "@careflow/db";
import { z } from "zod";
import { route, readJson } from "@/lib/server/api";
import { db } from "@/lib/server/db";

const schema = z.object({ status: z.enum(["in_progress", "done"]) });
export const POST = route("mission:status", async ({ ctx, req, params }) => setMissionStatus(db(), ctx, params.id!, schema.parse(await readJson(req)).status));
