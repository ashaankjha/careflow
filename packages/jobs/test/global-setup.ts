import { runMigrations } from "@careflow/db";
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export default async function setup() {
  for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) if (existsSync(p)) config({ path: p });
  const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/careflow_test";
  if (!/test/.test(url)) throw new Error("TEST_DATABASE_URL must point at a dedicated *test* database");
  const appUrl = process.env.TEST_APP_DATABASE_URL ?? "postgres://careflow_app:careflow_app_dev_only@localhost:5432/careflow_test";
  if (!/test/.test(appUrl)) throw new Error("TEST_APP_DATABASE_URL must point at a dedicated *test* database");
  process.env.TEST_DATABASE_URL = url;
  process.env.TEST_APP_DATABASE_URL = appUrl;
  await runMigrations(url, { appUrl });
}
