import { and, eq, lt, sql } from "drizzle-orm";
import { hashToken, newSessionToken, verifyPassword } from "../auth";
import type { Db, Executor } from "../client";
import { sessions } from "../schema";
import { withOrg } from "../tenant";
import type { Ctx } from "./context";
import { audit } from "./audit";

const SESSION_TTL_MS = 8 * 3_600_000;

type AuthRow = { user_id: string; organization_id: string; password_hash: string; role: Ctx["role"]; display_name: string };
type SessionRow = {
  user_id: string;
  organization_id: string;
  email: string;
  display_name: string;
  role: Ctx["role"];
  org_name: string;
  demo_mode: boolean;
  timezone: string;
};

/**
 * Sign-in happens before the tenant is known: the user row is fetched through
 * the SECURITY DEFINER function `careflow_auth_lookup` (migration 0002). Once
 * the password verifies, the session insert, expired-session cleanup and audit
 * run in a transaction scoped to the user's own organization.
 */
export async function login(db: Db, email: string, password: string) {
  const rows = (await db.execute(sql`select * from careflow_auth_lookup(${email.trim().toLowerCase()})`)) as unknown as AuthRow[];
  const u = rows[0];
  // constant-ish work even when the user doesn't exist
  const ok = u ? verifyPassword(password, u.password_hash) : (verifyPassword(password, "scrypt$00$00"), false);
  if (!u || !ok) return null;
  const { token, tokenHash } = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await withOrg(db, u.organization_id, async (tx) => {
    await tx.delete(sessions).where(and(eq(sessions.organizationId, u.organization_id), lt(sessions.expiresAt, new Date())));
    await tx.insert(sessions).values({ tokenHash, userId: u.user_id, organizationId: u.organization_id, expiresAt });
    await audit(tx, { orgId: u.organization_id, userId: u.user_id, role: u.role }, "auth.login", "user", u.user_id, true);
  });
  return { token, expiresAt, user: { id: u.user_id, role: u.role, displayName: u.display_name, organizationId: u.organization_id } };
}

export type SessionUser = {
  ctx: Ctx;
  user: { id: string; email: string; displayName: string; role: Ctx["role"] };
  org: { id: string; name: string; demoMode: boolean; timezone: string };
};

/** Cookie → session, via SECURITY DEFINER `careflow_resolve_session` (looks up by SHA-256 token hash only). */
export async function resolveSession(db: Executor, token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const rows = (await db.execute(sql`select * from careflow_resolve_session(${hashToken(token)})`)) as unknown as SessionRow[];
  const r = rows[0];
  if (!r) return null;
  return {
    ctx: { orgId: r.organization_id, userId: r.user_id, role: r.role },
    user: { id: r.user_id, email: r.email, displayName: r.display_name, role: r.role },
    org: { id: r.organization_id, name: r.org_name, demoMode: r.demo_mode, timezone: r.timezone },
  };
}

/** Revoke by token hash via SECURITY DEFINER `careflow_revoke_session`. */
export async function logout(db: Executor, token: string | undefined | null) {
  if (!token) return;
  await db.execute(sql`select careflow_revoke_session(${hashToken(token)})`);
}
