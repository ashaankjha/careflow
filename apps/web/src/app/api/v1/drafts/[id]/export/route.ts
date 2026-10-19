import { exportDraft } from "@careflow/db";
import { route, searchParams } from "@/lib/server/api";
import { db } from "@/lib/server/db";

/** Local preview only (Markdown or HTML). Nothing is published or sent. */
export const GET = route("draft:export", async ({ ctx, req, params }) => {
  const format = searchParams(req).get("format") === "html" ? "html" : "md";
  const r = await exportDraft(db(), ctx, params.id!, format);
  return new Response(r.content, {
    headers: { "content-type": format === "html" ? "text/html; charset=utf-8" : "text/markdown; charset=utf-8", "content-disposition": `inline; filename=draft-${r.draft.id.slice(0, 8)}.${format}` },
  });
});
