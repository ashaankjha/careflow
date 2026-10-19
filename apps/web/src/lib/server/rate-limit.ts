import "server-only";

/** In-memory token bucket (per process). Production should use a shared store. */
const buckets = new Map<string, { tokens: number; at: number }>();

export function rateLimit(key: string, capacity = 60, refillPerSec = 1): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: capacity, at: now };
  b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 1000) * refillPerSec);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 10_000) buckets.clear();
  return true;
}
