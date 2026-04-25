"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui";
import { useSession } from "./SessionProvider";
import type { Role } from "@/mocks/types";

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
  const { session, status } = useSession();

  useEffect(() => {
    if (status === "loading") return;

    if (status === "unauthenticated" || !session) {
      router.replace(loginRedirect);
      return;
    }

    if (allowRoles && !allowRoles.includes(session.user.role)) {
      // Role mismatch — route to their home
      router.replace(session.user.role === "staff" ? "/pos" : "/dashboard");
    }
  }, [status, session, allowRoles, loginRedirect, router]);

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
