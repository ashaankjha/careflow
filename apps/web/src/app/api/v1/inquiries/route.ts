import { createInquiry, listInquiries } from "@careflow/db";
import { route, readJson, searchParams } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const GET = route("inquiry:read", async ({ ctx, req }) => {
  const p = searchParams(req);
  return listInquiries(db(), ctx, {
    stage: (p.get("stage") as never) || undefined,
    centerId: p.get("centerId") || undefined,
    source: p.get("source") || undefined,
    ownerId: p.get("ownerId") || undefined,
    q: p.get("q")?.slice(0, 60) || undefined,
    page: Number(p.get("page") ?? 1),
    pageSize: Number(p.get("pageSize") ?? 50),
  });
});

export const POST = route("inquiry:create", async ({ ctx, req }) => {
  const body = await readJson(req);
  const res = await createInquiry(db(), ctx, body as never);
  return Response.json(res, { status: res.replayed ? 200 : 201 });
});
