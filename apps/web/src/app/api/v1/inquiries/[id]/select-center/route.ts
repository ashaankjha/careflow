import { selectCenter } from "@careflow/db";
import { z } from "zod";
import { route, readJson } from "@/lib/server/api";
import { db } from "@/lib/server/db";

const schema = z.object({ centerId: z.string().uuid(), idempotencyKey: z.string().min(8).max(100) });
export const POST = route("matching:persist", async ({ ctx, req, params }) => {
  const b = schema.parse(await readJson(req));
  return selectCenter(db(), ctx, params.id!, b.centerId, b.idempotencyKey);
});
