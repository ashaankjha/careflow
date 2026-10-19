import { listSources } from "@careflow/db";
import { route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route("sources:read", async ({ ctx }) => listSources(db(), ctx));
