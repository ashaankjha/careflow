/**
 * CSP violation report parsing (security gate R3). Browsers post reports
 * unauthenticated, so everything here treats the body as hostile: only a
 * sanitized summary survives — directive names, the blocked resource's origin
 * (or a CSP keyword such as `inline`), and the document path without query
 * string or fragment. Samples, full URLs, policies and bodies are dropped.
 */

export const CSP_REPORT_PATH = "/api/v1/csp-report";
export const CSP_REPORT_GROUP = "csp-endpoint";
export const CSP_REPORT_MAX_BYTES = 8 * 1024;
/** Most reports a single `application/reports+json` batch may contribute to the log. */
export const CSP_REPORT_MAX_PER_BATCH = 10;

export type CspReportSummary = { violatedDirective: string; effectiveDirective: string; blocked: string; documentPath: string; disposition: string };

const DIRECTIVE = /^[a-z][a-z-]{0,39}$/;
const KEYWORDS = new Set(["inline", "eval", "wasm-eval", "self", "data", "blob", "trusted-types-policy", "trusted-types-sink"]);

function directive(v: unknown): string {
  if (typeof v !== "string") return "unknown";
  // Older browsers send the whole directive ("script-src 'self' …"); keep only its name.
  const name = v.trim().split(/\s+/)[0]!.toLowerCase();
  return DIRECTIVE.test(name) ? name : "unknown";
}

function blocked(v: unknown): string {
  if (typeof v !== "string" || !v) return "none";
  const s = v.trim().toLowerCase();
  if (KEYWORDS.has(s)) return s;
  try {
    const u = new URL(s);
    if (u.origin !== "null") return u.origin;
    // data:, blob:, about: … — the scheme only, never the payload
    return /^[a-z][a-z0-9+.-]{0,19}:$/.test(u.protocol) ? u.protocol : "unknown";
  } catch {
    return "unknown";
  }
}

function documentPath(v: unknown): string {
  if (typeof v !== "string") return "unknown";
  try {
    const p = new URL(v).pathname;
    return p.length > 200 ? `${p.slice(0, 200)}…` : p;
  } catch {
    return "unknown";
  }
}

function disposition(v: unknown): string {
  return v === "report" ? "report" : "enforce";
}

const record = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/**
 * Parses either wire format into sanitized summaries:
 * `application/csp-report` (`{"csp-report": {...}}`, kebab-case keys) or
 * `application/reports+json` (Reporting API: an array of `{type, body}` with camelCase keys).
 * Returns null when the body is not a recognizable report.
 */
export function parseCspReport(contentType: string, text: string): CspReportSummary[] | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const ct = contentType.split(";")[0]!.trim().toLowerCase();
  if (ct === "application/csp-report") {
    const r = record(record(json)?.["csp-report"]);
    if (!r) return null;
    const effective = directive(r["effective-directive"] ?? r["violated-directive"]);
    return [{ violatedDirective: directive(r["violated-directive"] ?? r["effective-directive"]), effectiveDirective: effective, blocked: blocked(r["blocked-uri"]), documentPath: documentPath(r["document-uri"]), disposition: disposition(r.disposition) }];
  }
  if (ct === "application/reports+json") {
    if (!Array.isArray(json)) return null;
    const out: CspReportSummary[] = [];
    for (const item of json.slice(0, CSP_REPORT_MAX_PER_BATCH)) {
      const it = record(item);
      const b = record(it?.body);
      if (!it || !b || it.type !== "csp-violation") continue;
      const effective = directive(b.effectiveDirective);
      out.push({ violatedDirective: effective, effectiveDirective: effective, blocked: blocked(b.blockedURL), documentPath: documentPath(b.documentURL ?? it.url), disposition: disposition(b.disposition) });
    }
    return out;
  }
  return null;
}

/** One log line per report; every field is already sanitized, never a URL with a query string, a sample or a body. */
export function formatCspSummary(requestId: string, s: CspReportSummary): string {
  return `[csp-report] ${requestId} directive=${s.violatedDirective} effective=${s.effectiveDirective} blocked=${s.blocked} path=${s.documentPath} disposition=${s.disposition}`;
}

/** Reads at most `max` bytes from the body; returns null once the limit is exceeded (without buffering the rest). */
export async function readCapped(req: Request, max = CSP_REPORT_MAX_BYTES): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}
