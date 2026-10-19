import { getInquiryDetail } from "@careflow/db";
import { route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route("inquiry:read", async ({ ctx, params }) => getInquiryDetail(db(), ctx, params.id!));
