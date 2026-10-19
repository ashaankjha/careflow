import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The endpoint's rate limiter writes to Postgres; point it at the dedicated test database before importing server code.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/careflow_test";
process.env.APP_DATABASE_URL = process.env.TEST_APP_DATABASE_URL ?? "postgres://careflow_app:careflow_app_dev_only@localhost:5432/careflow_test";

const { createDb } = await import("@careflow/db");
const { parseCspReport, readCapped, CSP_REPORT_MAX_BYTES } = await import("@/lib/server/csp-report");
const { POST } = await import("@/app/api/v1/csp-report/route");

const { client } = createDb(process.env.DATABASE_URL!, { max: 1 });
afterAll(async () => {
  await client.end();
});

const legacy = {
  "csp-report": {
    "document-uri": "http://localhost:3000/intake?inquiry=abc&alias=Demo%20Family%204242#frag",
    "violated-directive": "script-src-elem 'self' 'nonce-xyz'",
    "effective-directive": "script-src-elem",
    "blocked-uri": "https://evil.example/x.js?token=secret-token",
    "original-policy": "default-src 'self'",
    "script-sample": "alert('sensitive-sample')",
  },
};
const modern = [
  { type: "csp-violation", url: "http://localhost:3000/missions?id=1", body: { documentURL: "http://localhost:3000/missions?id=secret-id", effectiveDirective: "style-src-attr", blockedURL: "inline", sample: "color:red sensitive-sample", disposition: "enforce" } },
  { type: "deprecation", body: { id: "x" } },
  { type: "csp-violation", body: { documentURL: "http://localhost:3000/", effectiveDirective: "img-src", blockedURL: "data:image/png;base64,AAAA" } },
];

const post = (body: string, contentType = "application/csp-report", ip = "203.0.113.7") =>
  new Request("http://localhost:3000/api/v1/csp-report", { method: "POST", headers: { "content-type": contentType, "x-forwarded-for": ip }, body });

describe("CSP report parsing", () => {
  it("summarizes legacy application/csp-report bodies without query strings, samples or full URLs", () => {
    expect(parseCspReport("application/csp-report", JSON.stringify(legacy))).toEqual([
      { violatedDirective: "script-src-elem", effectiveDirective: "script-src-elem", blocked: "https://evil.example", documentPath: "/intake", disposition: "enforce" },
    ]);
  });

  it("summarizes Reporting API batches, skipping non-CSP reports and reducing data: URLs to their scheme", () => {
    expect(parseCspReport("application/reports+json; charset=utf-8", JSON.stringify(modern))).toEqual([
      { violatedDirective: "style-src-attr", effectiveDirective: "style-src-attr", blocked: "inline", documentPath: "/missions", disposition: "enforce" },
      { violatedDirective: "img-src", effectiveDirective: "img-src", blocked: "data:", documentPath: "/", disposition: "enforce" },
    ]);
  });

  it("rejects malformed or unrecognized bodies and neutralizes junk fields", () => {
    expect(parseCspReport("application/csp-report", "{not json")).toBeNull();
    expect(parseCspReport("application/csp-report", "[]")).toBeNull();
    expect(parseCspReport("application/reports+json", "{}")).toBeNull();
    expect(parseCspReport("application/json", JSON.stringify(legacy))).toBeNull();
    const [r] = parseCspReport("application/csp-report", JSON.stringify({ "csp-report": { "violated-directive": "bad$name\ninjected=1", "blocked-uri": "not a url ?q=1", "document-uri": 42 } }))!;
    expect(r).toEqual({ violatedDirective: "unknown", effectiveDirective: "unknown", blocked: "unknown", documentPath: "unknown", disposition: "enforce" });
  });

  it("caps batches at ten reports", () => {
    const many = Array.from({ length: 50 }, () => modern[0]);
    expect(parseCspReport("application/reports+json", JSON.stringify(many))).toHaveLength(10);
  });

  it("stops reading bodies over the size limit", async () => {
    expect(await readCapped(post("x".repeat(CSP_REPORT_MAX_BYTES)))).toHaveLength(CSP_REPORT_MAX_BYTES);
    expect(await readCapped(post("x".repeat(CSP_REPORT_MAX_BYTES + 1)))).toBeNull();
  });
});

describe("POST /api/v1/csp-report", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    await client`delete from rate_limit_buckets`;
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());
  const logged = () => warn.mock.calls.flat().join("\n");

  it("accepts both report content types without credentials and logs only the sanitized summary", async () => {
    const a = await POST(post(JSON.stringify(legacy)));
    expect(a.status).toBe(204);
    expect(a.headers.get("x-request-id")).toBeTruthy();
    const b = await POST(post(JSON.stringify(modern), "application/reports+json"));
    expect(b.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(logged()).toContain(`[csp-report] ${a.headers.get("x-request-id")} directive=script-src-elem effective=script-src-elem blocked=https://evil.example path=/intake disposition=enforce`);
    expect(logged()).toContain("blocked=inline path=/missions");
    expect(logged()).not.toMatch(/\?|secret|token|Demo Family|sensitive-sample|nonce|default-src|#frag/);
  });

  it("rejects other content types, oversized and malformed bodies without logging them", async () => {
    expect((await POST(post(JSON.stringify(legacy), "application/json"))).status).toBe(415);
    expect((await POST(post(JSON.stringify(legacy), "text/plain"))).status).toBe(415);
    const big = JSON.stringify({ "csp-report": { "script-sample": "y".repeat(CSP_REPORT_MAX_BYTES) } });
    const tooBig = await POST(post(big));
    expect(tooBig.status).toBe(413);
    expect((await tooBig.json()).error.code).toBe("VALIDATION_FAILED");
    expect((await POST(post("{oops"))).status).toBe(400);
    expect(warn).not.toHaveBeenCalled();
  });

  it("rate limits per client IP", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) codes.push((await POST(post(JSON.stringify(legacy)))).status);
    expect(codes.slice(0, 30).every((c) => c === 204)).toBe(true);
    const limited = await POST(post(JSON.stringify(legacy)));
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe("RATE_LIMITED");
    // a different client is unaffected
    expect((await POST(post(JSON.stringify(legacy), "application/csp-report", "198.51.100.9"))).status).toBe(204);
  });
});
