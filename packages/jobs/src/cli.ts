import { appDatabaseUrl, createDb } from "@careflow/db";
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { JOBS, runJob } from "./index";

for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) if (existsSync(p)) config({ path: p });

const args = process.argv.slice(2);
const name = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--org");
const orgFlag = args.indexOf("--org");
const orgIds = orgFlag >= 0 ? (args[orgFlag + 1] ?? "").split(",").filter(Boolean) : undefined;
const job = JOBS.find((j) => j.name === name);
if (!job || (orgIds && orgIds.length === 0)) {
  console.info(
    `Usage: pnpm jobs <name> [--org <uuid>[,<uuid>…]]\n\nRuns as the least-privilege app role (APP_DATABASE_URL), once per organization (all by default).\n\n${JOBS.map((j) => `  ${j.name.padEnd(24)} ${j.schedule.padEnd(12)} ${j.description}`).join("\n")}`,
  );
  process.exit(name ? 1 : 0);
}
// APP role only — jobs never use the owner DATABASE_URL.
const { db, client } = createDb(appDatabaseUrl(), { max: 2 });
runJob(db, job, { orgIds })
  .then((runs) => {
    for (const r of runs) {
      if (r.ok) console.info(`✓ ${job.name} [org ${r.orgId}]`, JSON.stringify(r.result));
      else console.error(`✗ ${job.name} [org ${r.orgId}]: ${r.error}`);
    }
    if (runs.some((r) => !r.ok)) process.exitCode = 1;
  })
  .catch((e) => {
    console.error(`✗ ${job.name}: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(() => client.end());
