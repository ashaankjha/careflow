/** Minimal, escaping Markdown → HTML for local preview (headings, lists, bold, code, paragraphs). */
export function markdownToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/_(.+?)_/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  const out: string[] = [];
  let inList: "ul" | "ol" | null = null;
  let inCode = false;
  const closeList = () => {
    if (inList) out.push(`</${inList}>`);
    inList = null;
  };
  for (const line of md.split("\n")) {
    if (line.startsWith("```")) {
      closeList();
      out.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(esc(line));
      continue;
    }
    if (/^<!--.*-->$/.test(line.trim())) continue;
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(?:\[( |x)\]\s+)?(.*)$/.exec(line);
    const oli = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      out.push(`<h${h[1]!.length}>${inline(h[2]!)}</h${h[1]!.length}>`);
    } else if (li) {
      if (inList !== "ul") {
        closeList();
        out.push("<ul>");
        inList = "ul";
      }
      out.push(`<li>${li[1] !== undefined ? (li[1] === "x" ? "☑ " : "☐ ") : ""}${inline(li[2]!)}</li>`);
    } else if (oli) {
      if (inList !== "ol") {
        closeList();
        out.push("<ol>");
        inList = "ol";
      }
      out.push(`<li>${inline(oli[1]!)}</li>`);
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join("\n");
}
