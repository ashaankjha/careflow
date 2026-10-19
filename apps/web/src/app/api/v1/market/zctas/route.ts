import { marketZctas } from "@careflow/db";
import { route, searchParams } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route("market:read", async ({ ctx, req }) => {
  const bbox = searchParams(req).get("bbox")?.split(",").map(Number);
  const res = await marketZctas(db(), ctx, { bbox: bbox?.length === 4 && bbox.every(Number.isFinite) ? (bbox as [number, number, number, number]) : null });
  return { ...res, layer: searchParams(req).get("layer") ?? "opportunity" };
});
