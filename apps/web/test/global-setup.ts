import { runMigrations } from "@careflow/db";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/careflow_test";
  if (!/test/.test(url)) throw new Error("TEST_DATABASE_URL must point at a dedicated *test* database");
  await runMigrations(url, { appUrl: process.env.TEST_APP_DATABASE_URL ?? "postgres://careflow_app:careflow_app_dev_only@localhost:5432/careflow_test" });
}
