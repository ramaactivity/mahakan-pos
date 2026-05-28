import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Sesi AD-12: /m landing + sub-modules accessible without server-level auth
// guard. Sub-modules (/m/opname, /m/po, /m/jadwal) enforce client-side auth
// via useSession() — redirect to /pin if not authenticated. Landing /m
// itself is public so karyawan can pick module without login first.
const PUBLIC_PATHS = ["/", "/login", "/pin", "/showcase", "/absenkaryawan", "/m"];
const ADMIN_PATHS = ["/dashboard"];

/* Sesi AE-153 — Staff feedback: saat unauth user buka /pos di laptop/tablet/HP,
 * default redirect harus ke PIN login (kasir flow), bukan email/password
 * (yang dipakai owner/manager Back Office). Mirror RequireAuth client-side
 * routing. POS + mobile karyawan butuh PIN; Dashboard butuh email/pwd. */
function resolveLoginPathForTarget(pathname: string): "/login" | "/pin" {
  if (pathname === "/pos" || pathname.startsWith("/pos/")) return "/pin";
  /* /m paths are public; tapi defensive in case ada protected child paths. */
  if (pathname === "/m" || pathname.startsWith("/m/")) return "/pin";
  return "/login";
}

function matches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * Set Set-Cookie headers that override Auth.js' session cookie.
 *
 * `cookies.delete(name)` defaults the cookie path to the *request path* — so
 * deleting from `/dashboard` writes a cookie scoped to `/dashboard` which the
 * browser keeps separate from the original `/`-scoped cookie. The original
 * stays alive → user remains "authed" → endless redirect loop. We must set
 * an empty value with explicit `path: "/"` to actually evict it.
 *
 * Also: the `__Secure-` prefix is browser-enforced; the cookie must have the
 * `Secure` attribute on Set-Cookie or the browser ignores the response.
 */
function clearSessionCookies(res: NextResponse) {
  // Dev (HTTP) cookie name
  res.cookies.set("authjs.session-token", "", {
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    httpOnly: true,
  });
  // Prod (HTTPS) cookie name
  res.cookies.set("__Secure-authjs.session-token", "", {
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: true,
  });
}

export default auth((req) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;

  // A token that's signature-valid but past its `roleExp` should behave as
  // unauthenticated, regardless of where the user is. Without this branch the
  // middleware bounces /login → /dashboard → expired → /login → ...
  let isAuthed = Boolean(req.auth);
  let isExpired = false;
  if (isAuthed) {
    const nowSec = Math.floor(Date.now() / 1000);
    if (req.auth!.roleExp && nowSec > req.auth!.roleExp) {
      isExpired = true;
      isAuthed = false;
    }
  }

  // ---------- Public paths (/, /login, /pin, /showcase, /absenkaryawan) ----------
  if (matches(pathname, PUBLIC_PATHS)) {
    // Already-authed user landing on /login or /pin → bounce to their home.
    // /absenkaryawan stays accessible to anyone (Phase 4 mobile route — uses
    // its own attendance PIN flow, not session-based auth).
    if (isAuthed && (pathname === "/login" || pathname === "/pin")) {
      const target = req.auth!.user.role === "staff" ? "/pos" : "/dashboard";
      return NextResponse.redirect(new URL(target, nextUrl));
    }
    // Expired-token user on a public path: clear the stale cookie so the next
    // request is genuinely unauth — but DO NOT redirect (they're already on a
    // public page; the login form needs to render, not loop).
    if (isExpired) {
      const res = NextResponse.next();
      clearSessionCookies(res);
      return res;
    }
    return NextResponse.next();
  }

  // ---------- Protected paths ----------
  if (!isAuthed) {
    /* Sesi AE-153 — route-aware login redirect. /pos → /pin (PIN-only for
     * kasir/manager pinch); /dashboard → /login (email+password Back Office). */
    const loginPath = resolveLoginPathForTarget(pathname);
    const loginUrl = new URL(loginPath, nextUrl);
    if (isExpired) {
      loginUrl.searchParams.set("expired", "1");
    } else {
      loginUrl.searchParams.set("callbackUrl", pathname);
    }
    const res = NextResponse.redirect(loginUrl);
    if (isExpired) clearSessionCookies(res);
    return res;
  }

  // Staff cannot access admin pages — kick to /pos.
  if (matches(pathname, ADMIN_PATHS) && req.auth!.user.role === "staff") {
    return NextResponse.redirect(new URL("/pos", nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Exclude all API routes (each handler enforces its own auth via auth())
    // and Next/static assets/manifest/sw bundles.
    // Sesi AE-25 — pakai `[\\w-]*\\.webmanifest` supaya semua manifest file
    // (manifest.webmanifest + manifest-staff.webmanifest + future variants)
    // di-bypass dari auth gate. Sebelumnya cuma exclude manifest.webmanifest
    // → /manifest-staff.webmanifest ke-redirect ke /login → Chrome gagal
    // detect PWA installable + fallback ke "shortcut" mode.
    "/((?!api|_next/static|_next/image|favicon.ico|assets|[\\w-]*\\.webmanifest|sw\\.js|swe-worker-|icon-|apple-touch-icon).*)",
  ],
};
