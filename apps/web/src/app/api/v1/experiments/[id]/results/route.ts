import { experimentResults } from "@careflow/db";
import { route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route("experiment:read", async ({ ctx, params }) => experimentResults(db(), ctx, params.id!));
