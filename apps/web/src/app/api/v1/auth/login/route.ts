import { AppError, login, LOGIN_RATE_LIMITED_MESSAGE } from "@careflow/db";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { errorResponse } from "@/lib/server/api";
import { publicDb } from "@/lib/server/db";
import { rateLimit } from "@/lib/server/rate-limit";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/server/session";
import { cookies } from "next/headers";

const schema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export async function POST(req: Request) {
  const requestId = randomUUID();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!(await rateLimit(`login:${ip}`, 20, 60))) return errorResponse("RATE_LIMITED", LOGIN_RATE_LIMITED_MESSAGE, 429, requestId);
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return errorResponse("VALIDATION_FAILED", "Email and password required", 422, requestId);
  let res: Awaited<ReturnType<typeof login>>;
  try {
    res = await login(publicDb(), parsed.data.email, parsed.data.password);
  } catch (e) {
    // Per-account lockout: same code and message as the per-IP limit, for known and unknown emails alike.
    if (e instanceof AppError && e.code === "RATE_LIMITED") return errorResponse("RATE_LIMITED", LOGIN_RATE_LIMITED_MESSAGE, 429, requestId);
    throw e;
  }
  if (!res) return errorResponse("UNAUTHENTICATED", "Invalid email or password", 401, requestId);
  (await cookies()).set(SESSION_COOKIE, res.token, sessionCookieOptions(res.expiresAt));
  return Response.json({ user: res.user });
}
