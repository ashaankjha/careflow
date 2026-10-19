import { createDb, databaseUrl } from "@careflow/db";
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { JOBS, systemCtx } from "./index";

for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) if (existsSync(p)) config({ path: p });

const name = process.argv[2];
const job = JOBS.find((j) => j.name === name);
if (!job) {
  console.info(`Usage: pnpm jobs <name>\n\n${JOBS.map((j) => `  ${j.name.padEnd(24)} ${j.schedule.padEnd(12)} ${j.description}`).join("\n")}`);
  process.exit(name ? 1 : 0);
}
const { db, client } = createDb(databaseUrl(), { max: 2 });
job
  .run(db, systemCtx())
  .then((r) => console.info(`✓ ${job.name}`, JSON.stringify(r)))
  .catch((e) => {
    console.error(`✗ ${job.name}: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(() => client.end());
