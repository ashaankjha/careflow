import { migrate } from "drizzle-orm/postgres-js/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, databaseUrl } from "../client";
import { loadEnv } from "../env";

export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../drizzle");

export async function runMigrations(url: string) {
  const { db, client } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await client.end();
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
