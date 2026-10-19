import { createDb, databaseUrl } from "../client";
import { loadEnv } from "../env";
import { seedDatabase } from "../seed";

loadEnv();
const { db, client } = createDb(databaseUrl(), { max: 2 });
const started = Date.now();
seedDatabase(db)
  .then((r) => {
    console.info(
      `✓ ${process.argv.includes("--reset") ? "Demo reset to" : "Seeded"} exact synthetic state (anchor ${r.now}): ${r.inquiries} inquiries, ${r.events} events, ${r.missions} missions in ${Date.now() - started} ms`,
    );
  })
  .catch((e) => {
    console.error("Seed failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => client.end());
