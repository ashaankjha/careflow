import "server-only";
import { resolveSession, type SessionUser } from "@careflow/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { publicDb } from "./db";

export const SESSION_COOKIE = "cf_session";

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "true",
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

/** Server-component session lookup (validated against the DB on every request). */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  return resolveSession(publicDb(), jar.get(SESSION_COOKIE)?.value);
});

export async function requireSession(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}
