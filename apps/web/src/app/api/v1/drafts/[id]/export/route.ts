import { exportDraft } from "@careflow/db";
import { route, searchParams } from "@/lib/server/api";
import { db } from "@/lib/server/db";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Local preview only (Markdown or HTML). Nothing is published or sent. HTML is a full document whose `lang` matches the draft locale. */
export const GET = route("draft:export", async ({ ctx, req, params }) => {
  const format = searchParams(req).get("format") === "html" ? "html" : "md";
  const r = await exportDraft(db(), ctx, params.id!, format);
  const body =
    format === "html"
      ? `<!doctype html>\n<html lang="${esc(r.draft.locale)}">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(r.draft.title)}</title></head>\n<body>\n<main>\n${r.content}\n</main>\n</body>\n</html>\n`
      : r.content;
  return new Response(body, {
    headers: { "content-type": format === "html" ? "text/html; charset=utf-8" : "text/markdown; charset=utf-8", "content-language": r.draft.locale, "content-disposition": `inline; filename=draft-${r.draft.id.slice(0, 8)}.${format}` },
  });
});
