import { randomUUID } from "node:crypto";
import { errorResponse } from "@/lib/server/api";
import { formatCspSummary, parseCspReport, readCapped } from "@/lib/server/csp-report";
import { rateLimit } from "@/lib/server/rate-limit";

const ACCEPTED = new Set(["application/csp-report", "application/reports+json"]);

/**
 * CSP violation reports (security gate R3). Unauthenticated and exempt from the
 * same-origin check by necessity: browsers send reports without credentials and
 * may omit or null the Origin. It changes no application state — it only logs a
 * sanitized summary — and is capped at 8 KB per body and 30 posts/min per client IP.
 */
export async function POST(req: Request) {
  const requestId = randomUUID();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!(await rateLimit(`csp:${ip}`, 30, 60))) return errorResponse("RATE_LIMITED", "Too many reports", 429, requestId);
  const ct = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!ACCEPTED.has(ct)) return errorResponse("VALIDATION_FAILED", "Expected application/csp-report or application/reports+json", 415, requestId);
  const text = await readCapped(req);
  if (text === null) return errorResponse("VALIDATION_FAILED", "Report too large", 413, requestId);
  const reports = parseCspReport(ct, text);
  if (!reports) return errorResponse("VALIDATION_FAILED", "Malformed report", 400, requestId);
  for (const r of reports) console.warn(formatCspSummary(requestId, r));
  return new Response(null, { status: 204, headers: { "x-request-id": requestId, "cache-control": "no-store" } });
}
