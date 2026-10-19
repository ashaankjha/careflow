import "server-only";
import { can, type Action } from "@careflow/core";
import { AppError, audit, resolveSession, type Ctx, type Db, type SessionUser } from "@careflow/db";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { publicDb, withOrg } from "./db";
import { rateLimit } from "./rate-limit";
import { SESSION_COOKIE } from "./session";

/** `db` is the request's tenant-scoped transaction (same object `db()` returns inside the handler). */
export type ApiContext = { ctx: Ctx; session: SessionUser; req: Request; params: Record<string, string>; db: Db };

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function errorResponse(code: string, message: string, status: number, requestId: string, details?: unknown) {
  return Response.json({ error: { code, message, requestId, ...(details ? { details } : {}) } }, { status, headers: { "x-request-id": requestId, "cache-control": "no-store" } });
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** CSRF defense: same-origin check on every mutation (plus SameSite=Lax cookies and JSON-only bodies). */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin) return req.headers.get("sec-fetch-site") === "same-origin";
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function readJson<T = unknown>(req: Request, maxBytes = 256_000): Promise<T> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) throw new AppError("VALIDATION_FAILED", "Expected application/json (file attachments are not accepted)");
  const text = await req.text();
  if (text.length > maxBytes) throw new AppError("VALIDATION_FAILED", "Request body too large");
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AppError("VALIDATION_FAILED", "Malformed JSON");
  }
}

type Handler = (a: ApiContext) => Promise<unknown>;
// `unknown` satisfies Next's generated per-route context types for both static and [id] routes.
type RouteCtx = { params: Promise<unknown> };

/**
 * Typed route handler wrapper: authentication, RBAC pre-check, CSRF, rate
 * limiting, error envelope {error:{code,message,requestId}}. The handler runs
 * inside one app-role transaction with `app.current_org` set to the session's
 * organization (RLS). Request bodies are never logged.
 */
export function route(action: Action | null, fn: Handler) {
  return async (req: Request, routeCtx: RouteCtx): Promise<Response> => {
    const requestId = randomUUID();
    let session: SessionUser | null = null;
    try {
      if (MUTATING.has(req.method) && !sameOrigin(req)) {
        return errorResponse("FORBIDDEN", "Cross-origin request rejected", 403, requestId);
      }
      session = await resolveSession(publicDb(), readCookie(req, SESSION_COOKIE));
      if (!session) return errorResponse("UNAUTHENTICATED", "Sign in required", 401, requestId);
      const ctx: Ctx = { ...session.ctx, requestId };
      const limitKey = `${session.user.id}:${MUTATING.has(req.method) ? "w" : "r"}`;
      if (!(await rateLimit(limitKey, MUTATING.has(req.method) ? 60 : 300, 60))) {
        return errorResponse("RATE_LIMITED", "Too many requests — slow down", 429, requestId);
      }
      if (action && !can(ctx.role, action)) {
        await withOrg(ctx, (db) => audit(db, ctx, `denied:${action}`, "route", new URL(req.url).pathname, false));
        return errorResponse("FORBIDDEN", `Role '${ctx.role}' may not perform ${action}`, 403, requestId);
      }
      const params = ((routeCtx?.params ? await routeCtx.params : {}) ?? {}) as Record<string, string>;
      const s = session;
      const result = await withOrg(ctx, (db) => fn({ ctx, session: s, req, params, db }));
      if (result instanceof Response) return result;
      return Response.json(result ?? { ok: true }, { headers: { "x-request-id": requestId, "cache-control": "no-store" } });
    } catch (e) {
      if (e instanceof AppError) {
        if (e.code === "FORBIDDEN" && session) {
          const ctx: Ctx = { ...session.ctx, requestId };
          await withOrg(ctx, (db) => audit(db, ctx, "denied", "route", new URL(req.url).pathname, false)).catch(() => {});
        }
        return errorResponse(e.code, e.message, e.status, requestId, e.details);
      }
      if (e instanceof ZodError) {
        return errorResponse("VALIDATION_FAILED", "Request validation failed", 422, requestId, e.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
      }
      // Never log request bodies or sensitive values — only the error class and request id.
      const code = (e as { code?: string; cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code ?? "";
      console.error(`[api] ${requestId} ${req.method} ${new URL(req.url).pathname} failed: ${e instanceof Error ? e.name : "unknown"} ${code}`);
      return errorResponse("INTERNAL", "Unexpected server error", 500, requestId);
    }
  };
}

export function searchParams(req: Request) {
  return new URL(req.url).searchParams;
}
