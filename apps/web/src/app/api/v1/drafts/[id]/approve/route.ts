import { approveDraft } from "@careflow/db";
import { route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const POST = route("draft:approve", async ({ ctx, params }) => approveDraft(db(), ctx, params.id!));
