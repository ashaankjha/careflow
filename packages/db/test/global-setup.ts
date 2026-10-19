import { loadEnv } from "../src/env";
import { runMigrations } from "../src/scripts/migrate";

export default async function setup() {
  loadEnv();
  const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/careflow_test";
  if (!/test/.test(url)) throw new Error("TEST_DATABASE_URL must point at a dedicated *test* database");
  process.env.TEST_DATABASE_URL = url;
  await runMigrations(url);
}
