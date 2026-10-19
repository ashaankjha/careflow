import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request nonce CSP (security gate R3). Next.js reads the nonce from the
 * request's Content-Security-Policy header and stamps it on its own bootstrap
 * and flight scripts; 'strict-dynamic' lets those load the chunks they need.
 * Styles keep 'unsafe-inline' because React/Radix/Recharts set inline style
 * attributes, which nonces cannot cover. First-party only (PRD §15).
 */
export function contentSecurityPolicy(nonce: string, dev = process.env.NODE_ENV !== "production") {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** Paths reachable without a session cookie. */
const PUBLIC = /^\/(login|api|robots\.txt)(\/|$)/;

export function middleware(req: NextRequest) {
  // Cheap gate: pages without a session cookie go to /login. Real validation happens server-side.
  if (!PUBLIC.test(req.nextUrl.pathname) && !req.cookies.get("cf_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

// Static build assets carry no inline script and need no nonce.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
