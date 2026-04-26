import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const PUBLIC_PATHS = ["/", "/login", "/pin", "/showcase"];
const ADMIN_PATHS = ["/dashboard"];

function matches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export default auth((req) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;
  const isAuthed = Boolean(req.auth);

  if (matches(pathname, PUBLIC_PATHS)) {
    if (isAuthed && (pathname === "/login" || pathname === "/pin")) {
      const target = req.auth!.user.role === "staff" ? "/pos" : "/dashboard";
      return NextResponse.redirect(new URL(target, nextUrl));
    }
    return NextResponse.next();
  }

  if (!isAuthed) {
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const session = req.auth!;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (session.roleExp && nowSeconds > session.roleExp) {
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("expired", "1");
    const res = NextResponse.redirect(loginUrl);
    res.cookies.delete("authjs.session-token");
    res.cookies.delete("__Secure-authjs.session-token");
    return res;
  }

  if (matches(pathname, ADMIN_PATHS) && session.user.role === "staff") {
    return NextResponse.redirect(new URL("/pos", nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Exclude all API routes (each handler enforces its own auth via auth())
    // and Next/static assets/manifest/sw bundles.
    "/((?!api|_next/static|_next/image|favicon.ico|assets|manifest.webmanifest|sw\\.js|swe-worker-|icon-|apple-touch-icon).*)",
  ],
};
