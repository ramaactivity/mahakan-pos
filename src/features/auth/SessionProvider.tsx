"use client";

import { useMemo, type ReactNode } from "react";
import {
  SessionProvider as NextAuthSessionProvider,
  useSession as useNextAuthSession,
  signOut as nextAuthSignOut,
} from "next-auth/react";
import type { Role } from "@/lib/auth";

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
  logout: () => Promise<void>;
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
    logout: async () => {
      await nextAuthSignOut({ redirect: false });
    },
  };
}
