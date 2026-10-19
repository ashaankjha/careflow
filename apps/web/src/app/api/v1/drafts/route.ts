import { listDrafts } from "@careflow/db";
import { route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route("mission:read", async ({ ctx }) => listDrafts(db(), ctx));
