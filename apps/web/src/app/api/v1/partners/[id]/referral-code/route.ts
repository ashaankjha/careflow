import { createReferralCode } from "@careflow/db";
import { route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const POST = route("partner:manage", async ({ ctx, params }) => createReferralCode(db(), ctx, params.id!));
