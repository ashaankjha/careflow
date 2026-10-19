import { sendDraft } from "@careflow/db";
import { route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

/** Always 403 FEATURE_DISABLED in the MVP. */
export const POST = route(null, async ({ ctx, params }) => sendDraft(db(), ctx, params.id!));
