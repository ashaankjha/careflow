import { can } from "@careflow/core";
import { listInquiryHolds, reserveHold, reserveHoldSchema } from "@careflow/db";
import { route, readJson } from "@/lib/server/api";
import { db } from "@/lib/server/db";

/** Capacity holds for an inquiry plus the caller's hold affordances (UI hints only; enforced server-side). */
export const GET = route("inquiry:read", async ({ ctx, params }) => ({
  ...(await listInquiryHolds(db(), ctx, params.id!)),
  canReserve: can(ctx.role, "hold:reserve"),
  canRelease: can(ctx.role, "hold:release"),
}));

/** Reserve verified capacity at a center (locked transaction). Reserved is not an appointment. */
export const POST = route("hold:reserve", async ({ ctx, req, params }) => reserveHold(db(), ctx, params.id!, reserveHoldSchema.parse(await readJson(req))));
