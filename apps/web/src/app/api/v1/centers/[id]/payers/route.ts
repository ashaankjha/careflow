import { getCenterCapacity, updateCenterPayers } from "@careflow/db";
import { route, readJson } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route("capacity:read", async ({ ctx, params }) => (await getCenterCapacity(db(), ctx, params.id!)).payers);
export const PUT = route("payer:edit", async ({ ctx, req, params }) => (await updateCenterPayers(db(), ctx, params.id!, (await readJson(req)) as never)).payers);
