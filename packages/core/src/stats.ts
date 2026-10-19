/** Small, dependency-free statistics helpers used by metrics and experiments. */

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

export function safeRate(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

/** Wilson score interval for a binomial proportion (default 95%). */
export function wilsonInterval(successes: number, n: number, z = 1.96): { low: number; high: number } | null {
  if (n <= 0) return null;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

/** Newcombe (method 10) interval for a difference of two independent proportions p1 - p2. */
export function newcombeDiffInterval(
  s1: number,
  n1: number,
  s2: number,
  n2: number,
  z = 1.96,
): { low: number; high: number } | null {
  const a = wilsonInterval(s1, n1, z);
  const b = wilsonInterval(s2, n2, z);
  if (!a || !b) return null;
  const p1 = s1 / n1;
  const p2 = s2 / n2;
  const d = p1 - p2;
  const low = d - Math.sqrt((p1 - a.low) ** 2 + (b.high - p2) ** 2);
  const high = d + Math.sqrt((a.high - p1) ** 2 + (p2 - b.low) ** 2);
  return { low: Math.max(-1, low), high: Math.min(1, high) };
}

/** Mulberry32 — tiny deterministic PRNG for seed fixtures (never for security). */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)]!,
    chance: (p: number) => next() < p,
    weighted: <T>(items: readonly (readonly [T, number])[]): T => {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [item, w] of items) {
        r -= w;
        if (r <= 0) return item;
      }
      return items[items.length - 1]![0];
    },
  };
}
