"use client";

import { useMemo, type ReactNode } from "react";
import {
  SessionProvider as NextAuthSessionProvider,
  useSession as useNextAuthSession,
  signOut as nextAuthSignOut,
} from "next-auth/react";
import type { Role } from "@/lib/auth";
import { clearCache } from "@/lib/cache-store";

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  role: Role;
  outletId: string;
}

export interface SessionData {
  user: SessionUser;
  expires: string;
}

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

interface SessionContextValue {
  session: SessionData | null;
  status: SessionStatus;
  refresh: () => Promise<unknown>;
  logout: (callbackUrl?: string) => Promise<void>;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  return <NextAuthSessionProvider>{children}</NextAuthSessionProvider>;
}

export function useSession(): SessionContextValue {
  const { data, status, update } = useNextAuthSession();

  const session = useMemo<SessionData | null>(() => {
    if (!data) return null;
    return {
      user: {
        id: data.user.id,
        name: data.user.name,
        email: data.user.email ?? null,
        role: data.user.role,
        outletId: data.user.outletId,
      },
      expires: data.expires,
    };
  }, [data]);

  return {
    session,
    status,
    refresh: update,
    logout: async (callbackUrl: string = "/login") => {
      // Clear the server-side session cookie, then hard-navigate to ensure
      // all client-side React state (including stale useSession context) is
      // discarded. Without window.location.assign, the next page would mount
      // with the still-cached session and auto-redirect back to the
      // dashboard — making "logout then login as different user"
      // effectively impossible from the same tab.
      //
      // Also nuke the localStorage reference-data cache so the next user
      // doesn't see the previous user's outlet's COA / suppliers / etc.
      // (currently same outlet, but future-proof against multi-outlet).
      clearCache();
      await nextAuthSignOut({ redirect: false });
      window.location.assign(callbackUrl);
    },
  };
}
