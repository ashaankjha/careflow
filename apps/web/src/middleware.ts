import { NextResponse, type NextRequest } from "next/server";

/** Cheap gate: pages without a session cookie go to /login. Real validation happens server-side. */
export function middleware(req: NextRequest) {
  if (!req.cookies.get("cf_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!login|api|_next|favicon.ico|robots.txt).*)"] };
