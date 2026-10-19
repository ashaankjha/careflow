import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appDatabaseUrl, createDb, databaseUrl, type Db } from "../client";
import { loadEnv } from "../env";

export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../drizzle");
export const APP_ROLE = "careflow_app";

/**
 * Migration 0002 creates `careflow_app` NOLOGIN with no password (no secrets in
 * migrations). Here the migration role enables LOGIN with the password from the
 * app URL, so APP_DATABASE_URL stays the single source of truth. Idempotent.
 * Skipped (with a notice) when the URL names a different, externally managed role.
 */
export async function syncAppRole(db: Db, appUrl: string): Promise<boolean> {
  let user: string;
  let password: string;
  try {
    const u = new URL(appUrl);
    user = decodeURIComponent(u.username);
    password = decodeURIComponent(u.password);
  } catch {
    throw new Error("APP_DATABASE_URL is not a valid URL");
  }
  if (user !== APP_ROLE || !password) {
    console.info(`ℹ app role password not synced (APP_DATABASE_URL user is '${user || "?"}', expected '${APP_ROLE}' with a password)`);
    return false;
  }
  // ALTER ROLE does not take bind parameters; quote the literal safely.
  await db.execute(sql.raw(`ALTER ROLE ${APP_ROLE} WITH LOGIN PASSWORD '${password.replace(/'/g, "''")}'`));
  return true;
}

export async function runMigrations(url: string, opts: { appUrl?: string | null } = {}) {
  const { db, client } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    const appUrl = opts.appUrl === undefined ? appDatabaseUrl() : opts.appUrl;
    if (appUrl) await syncAppRole(db, appUrl);
  } finally {
    await client.end();
  }
}

/** Seed/reset/purge must run as a role that bypasses the FORCEd RLS policies. */
export async function assertMaintenanceRole(db: Db): Promise<void> {
  const rows = (await db.execute(sql`select rolsuper or rolbypassrls as ok, current_user as name from pg_roles where rolname = current_user`)) as unknown as { ok: boolean; name: string }[];
  if (!rows[0]?.ok) {
    throw new Error(`Role '${rows[0]?.name ?? "?"}' cannot seed/reset: DATABASE_URL must be the owner role with SUPERUSER or BYPASSRLS (RLS is forced on tenant tables)`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnv();
  const url = databaseUrl();
  runMigrations(url)
    .then(() => {
      console.info(`✓ migrations applied to ${url.replace(/:[^:@/]+@/, ":***@")}`);
    })
    .catch((e) => {
      console.error("Migration failed:", e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
