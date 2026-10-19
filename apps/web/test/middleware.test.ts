import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, middleware } from "@/middleware";

const req = (path: string, cookie?: string) => new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} });
const scriptSrc = (csp: string) => csp.split("; ").find((d) => d.startsWith("script-src "))!;

describe("middleware", () => {
  it("redirects pages without a session cookie to /login", () => {
    const res = middleware(req("/capacity?x=1"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("lets public paths through and still sets a CSP", () => {
    for (const p of ["/login", "/api/v1/health", "/robots.txt"]) {
      const res = middleware(req(p));
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("content-security-policy")).toContain("'strict-dynamic'");
    }
  });

  it("passes a fresh nonce to Next via request headers and the response CSP", () => {
    const a = middleware(req("/", "cf_session=x"));
    const b = middleware(req("/", "cf_session=x"));
    const csp = a.headers.get("content-security-policy")!;
    const nonce = /'nonce-([^']+)'/.exec(csp)![1]!;
    expect(a.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(a.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    expect(b.headers.get("content-security-policy")).not.toContain(nonce);
  });

  it("never allows inline or eval scripts in production", () => {
    const s = scriptSrc(contentSecurityPolicy("abc", false));
    expect(s).toBe("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(contentSecurityPolicy("abc", false)).toContain("object-src 'none'");
  });
});
