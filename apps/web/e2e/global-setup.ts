import { createDb, databaseUrl, seedDatabase } from "@careflow/db";
import { config } from "dotenv";
import { resolve } from "node:path";

/** Every E2E run starts from the exact deterministic seed state. */
export default async function globalSetup() {
  config({ path: resolve(process.cwd(), "../../.env") });
  const { db, client } = createDb(databaseUrl(), { max: 2 });
  try {
    await seedDatabase(db);
  } finally {
    await client.end();
  }
}
