"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Spinner } from "@/components/ui";
import { useSession } from "./SessionProvider";
import type { Role } from "@/lib/auth";

interface RequireAuthProps {
  children: ReactNode;
  /** If provided, session user must have one of these roles. */
  allowRoles?: Role[];
  /** Where to send unauthenticated users. Default /login. */
  loginRedirect?: string;
}

export function RequireAuth({
  children,
  allowRoles,
  loginRedirect = "/login",
}: RequireAuthProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { session, status } = useSession();

  useEffect(() => {
    if (status === "loading") return;

    if (status === "unauthenticated" || !session) {
      /* Sesi AE-127 — append `?next=<currentPath>` ke login URL supaya
       * auth page tahu user datang dari mana (mis. dari /dashboard) →
       * hide switcher POS/Back Office, langsung tampilkan form yang
       * sesuai. Plus, setelah login sukses, redirect balik ke `next`
       * supaya owner langsung sampai ke section yang dia tuju. */
      const url = pathname
        ? `${loginRedirect}?next=${encodeURIComponent(pathname)}`
        : loginRedirect;
      router.replace(url);
      return;
    }

    if (allowRoles && !allowRoles.includes(session.user.role)) {
      // Role mismatch — route to their home
      router.replace(session.user.role === "staff" ? "/pos" : "/dashboard");
    }
  }, [status, session, allowRoles, loginRedirect, router, pathname]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="size-8 text-mahakan-green-700" />
      </div>
    );
  }

  if (status === "unauthenticated" || !session) {
    // Redirect in-flight; render nothing
    return null;
  }

  if (allowRoles && !allowRoles.includes(session.user.role)) {
    return null;
  }

  return <>{children}</>;
}
