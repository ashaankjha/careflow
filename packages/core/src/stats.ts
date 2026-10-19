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

/** ln Γ(x) via the Lanczos approximation (g = 7, n = 9); accurate to ~1e-13 for x > 0. */
function lnGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const xx = x - 1;
  let a = c[0]!;
  const t = xx + 7.5;
  for (let i = 1; i < 9; i++) a += c[i]! / (xx + i);
  return 0.5 * Math.log(2 * Math.PI) + (xx + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the regularized incomplete beta (Lentz). */
function betaCf(a: number, b: number, x: number): number {
  const TINY = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
function incBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betaCf(a, b, x)) / a : 1 - (bt * betaCf(b, a, 1 - x)) / b;
}

/** Student-t CDF with `df` degrees of freedom. */
export function studentTCdf(t: number, df: number): number {
  const tail = 0.5 * incBeta(df / (df + t * t), df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

/** Two-sided Student-t critical value: P(|T| ≤ q) = level. Solved by bisection (deterministic). */
export function studentTQuantile(level: number, df: number): number {
  if (!(df > 0)) throw new Error("df must be positive");
  const target = 0.5 + level / 2;
  let lo = 0;
  let hi = 1e6;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (studentTCdf(mid, df) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export type ClusterCount = { denominator: number; successes: number };

/**
 * Cluster-robust variance of a pooled proportion p = Σy / Σn treated as a ratio
 * estimator over k independent clusters (Taylor linearization with the k/(k-1)
 * small-sample factor): Var(p) = k/(k-1) · Σ(y_i − p·n_i)² / (Σn)².
 * Clusters with no observations carry no information and are dropped.
 */
export function clusterRatioVariance(clusters: ClusterCount[]): { rate: number; variance: number; clusters: number; n: number } | null {
  const cs = clusters.filter((c) => c.denominator > 0);
  const k = cs.length;
  const n = cs.reduce((s, c) => s + c.denominator, 0);
  if (k < 2 || n <= 0) return null;
  const y = cs.reduce((s, c) => s + c.successes, 0);
  const rate = y / n;
  const ss = cs.reduce((s, c) => s + (c.successes - rate * c.denominator) ** 2, 0);
  return { rate, variance: ((k / (k - 1)) * ss) / (n * n), clusters: k, n };
}

/**
 * 95% cluster-robust interval for one arm's pooled proportion:
 * p ± t_{k−1} · SE_cluster. It is never reported narrower than the per-inquiry
 * Wilson interval (the design effect is floored at 1), so zero-variance or
 * boundary cases cannot look more certain than an unclustered analysis.
 */
export function clusterRateInterval(clusters: ClusterCount[]): { low: number; high: number; designEffect: number | null } | null {
  const v = clusterRatioVariance(clusters);
  if (!v) return null;
  const w = wilsonInterval(Math.round(v.rate * v.n), v.n)!;
  const half = studentTQuantile(0.95, v.clusters - 1) * Math.sqrt(v.variance);
  const binomVar = (v.rate * (1 - v.rate)) / v.n;
  return {
    low: Math.max(0, Math.min(v.rate - half, w.low)),
    high: Math.min(1, Math.max(v.rate + half, w.high)),
    designEffect: binomVar > 0 ? v.variance / binomVar : null,
  };
}

/**
 * Cluster-robust interval for a difference of pooled proportions p1 − p2 from
 * independently randomized cluster arms: SE = √(V1 + V2), t with the
 * conservative min(k1, k2) − 1 degrees of freedom. Never narrower than the
 * Newcombe interval on the same totals.
 */
export function clusterDiffInterval(arm1: ClusterCount[], arm2: ClusterCount[]): { low: number; high: number; df: number } | null {
  const a = clusterRatioVariance(arm1);
  const b = clusterRatioVariance(arm2);
  if (!a || !b) return null;
  const df = Math.min(a.clusters, b.clusters) - 1;
  const d = a.rate - b.rate;
  const half = studentTQuantile(0.95, df) * Math.sqrt(a.variance + b.variance);
  const nc = newcombeDiffInterval(Math.round(a.rate * a.n), a.n, Math.round(b.rate * b.n), b.n)!;
  return { low: Math.max(-1, Math.min(d - half, nc.low)), high: Math.min(1, Math.max(d + half, nc.high)), df };
}
