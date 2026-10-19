import { login } from "@careflow/db";
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
  if (!(await rateLimit(`login:${ip}`, 20, 60))) return errorResponse("RATE_LIMITED", "Too many sign-in attempts", 429, requestId);
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return errorResponse("VALIDATION_FAILED", "Email and password required", 422, requestId);
  const res = await login(publicDb(), parsed.data.email, parsed.data.password);
  if (!res) return errorResponse("UNAUTHENTICATED", "Invalid email or password", 401, requestId);
  (await cookies()).set(SESSION_COOKIE, res.token, sessionCookieOptions(res.expiresAt));
  return Response.json({ user: res.user });
}
