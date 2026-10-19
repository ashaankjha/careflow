import "server-only";
import { hitRateLimit } from "@careflow/db";
import { publicDb } from "./db";

/**
 * Shared fixed-window limiter (Postgres `rate_limit_buckets`, one upsert per
 * call), so limits hold across processes and nodes. Runs on its own autocommit
 * statement — outside the request transaction — so rejected or rolled-back
 * requests still count.
 */
export async function rateLimit(key: string, limit: number, windowSeconds = 60): Promise<boolean> {
  return (await hitRateLimit(publicDb(), key, limit, windowSeconds)).allowed;
}
