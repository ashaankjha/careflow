import { getCenterCapacity, updateCenterCapacity } from "@careflow/db";
import { route, readJson } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route("capacity:read", async ({ ctx, params }) => getCenterCapacity(db(), ctx, params.id!));
export const PUT = route("capacity:edit", async ({ ctx, req, params }) => updateCenterCapacity(db(), ctx, params.id!, (await readJson(req)) as never));
