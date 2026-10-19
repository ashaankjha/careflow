import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Load the monorepo root .env for CLI scripts (Next.js loads its own). */
export function loadEnv() {
  for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
    if (existsSync(p)) {
      config({ path: p });
      return;
    }
  }
}
