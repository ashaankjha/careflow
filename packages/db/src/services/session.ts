import { and, eq, gt, lt } from "drizzle-orm";
import { hashToken, newSessionToken, verifyPassword } from "../auth";
import type { Db } from "../client";
import { organizations, sessions, users } from "../schema";
import type { Ctx } from "./context";
import { audit } from "./audit";

const SESSION_TTL_MS = 8 * 3_600_000;

export async function login(db: Db, email: string, password: string) {
  const [u] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  // constant-ish work even when the user doesn't exist
  const ok = u ? verifyPassword(password, u.passwordHash) : (verifyPassword(password, "scrypt$00$00"), false);
  if (!u || !ok) return null;
  const { token, tokenHash } = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  await db.insert(sessions).values({ tokenHash, userId: u.id, organizationId: u.organizationId, expiresAt });
  await audit(db, { orgId: u.organizationId, userId: u.id, role: u.role }, "auth.login", "user", u.id, true);
  return { token, expiresAt, user: { id: u.id, role: u.role, displayName: u.displayName, organizationId: u.organizationId } };
}

export type SessionUser = {
  ctx: Ctx;
  user: { id: string; email: string; displayName: string; role: Ctx["role"] };
  org: { id: string; name: string; demoMode: boolean; timezone: string };
};

export async function resolveSession(db: Db, token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const [row] = await db
    .select({ s: sessions, u: users, o: organizations })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(organizations, eq(organizations.id, users.organizationId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())));
  if (!row || row.s.organizationId !== row.u.organizationId) return null;
  return {
    ctx: { orgId: row.u.organizationId, userId: row.u.id, role: row.u.role },
    user: { id: row.u.id, email: row.u.email, displayName: row.u.displayName, role: row.u.role },
    org: { id: row.o.id, name: row.o.name, demoMode: row.o.demoMode, timezone: row.o.timezone },
  };
}

export async function logout(db: Db, token: string | undefined | null) {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}
