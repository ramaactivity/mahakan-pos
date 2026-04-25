"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { authService } from "@/mocks/services";
import type { Session } from "@/mocks/types";

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

interface SessionContextValue {
  session: Session | null;
  status: SessionStatus;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");

  const refresh = useCallback(async () => {
    const res = await authService.getSession();
    if (res.success) {
      setSession(res.data);
      setStatus(res.data ? "authenticated" : "unauthenticated");
    } else {
      setSession(null);
      setStatus("unauthenticated");
    }
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
    setSession(null);
    setStatus("unauthenticated");
  }, []);

  useEffect(() => {
    // Initialize session from mock store on mount. setState inside effect is
    // intentional here — we're syncing React state with an external async source.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return (
    <SessionContext.Provider value={{ session, status, refresh, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return ctx;
}
