/** fetch with hard timeout and exponential backoff (public, read-only sources only). */
export async function fetchWithRetry(
  url: string,
  opts: { retries?: number; timeoutMs?: number; fetchImpl?: typeof fetch; baseDelayMs?: number } = {},
): Promise<Response> {
  const { retries = 3, timeoutMs = 8000, fetchImpl = fetch, baseDelayMs = 500 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: ctrl.signal, headers: { "user-agent": "CareFlow-demo/0.1 (public data refresh)" } });
      clearTimeout(timer);
      if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < retries) await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
