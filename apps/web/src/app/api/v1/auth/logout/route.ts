import { logout } from "@careflow/db";
import { cookies } from "next/headers";
import { db } from "@/lib/server/db";
import { SESSION_COOKIE } from "@/lib/server/session";

export async function POST() {
  const jar = await cookies();
  await logout(db(), jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
