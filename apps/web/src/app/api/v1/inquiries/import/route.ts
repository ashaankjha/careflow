import { importInquiriesCsv } from "@careflow/db";
import { z } from "zod";
import { route, readJson } from "@/lib/server/api";
import { db } from "@/lib/server/db";

const schema = z.object({ csv: z.string().max(512_000), commit: z.boolean().default(false) });
export const POST = route("inquiry:import", async ({ ctx, req }) => {
  const b = schema.parse(await readJson(req, 600_000));
  return importInquiriesCsv(db(), ctx, b.csv, b.commit);
});
