"use client";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly requestId?: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function idemKey(prefix = "ui") {
  return `${prefix}-${crypto.randomUUID()}`;
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
  });
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const e = (data as { error?: { code: string; message: string; requestId?: string; details?: unknown } })?.error;
    throw new ApiError(e?.code ?? "HTTP_" + res.status, e?.message ?? `Request failed (${res.status})`, res.status, e?.requestId, e?.details);
  }
  return data as T;
}
