import { generateMissions } from "@careflow/db";
import { route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const POST = route("mission:generate", async ({ ctx }) => {
  const r = await generateMissions(db(), ctx);
  return { created: r.created.length, refreshed: r.refreshed.length, unchanged: r.unchanged.length, proposals: r.proposals };
});
