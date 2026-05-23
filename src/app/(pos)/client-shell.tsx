"use client";

import type { ReactNode } from "react";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { WorkspaceSwitcher } from "@/components/ui/WorkspaceSwitcher";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { useSession } from "@/features/auth/SessionProvider";
import { FullscreenToggle } from "@/features/pos/components/FullscreenToggle";
import { QueryProvider } from "@/features/_shared/QueryProvider";

/**
 * Sesi AE-126 — Client shell untuk POS route group. Split dari layout
 * supaya server layout bisa export metadata.
 */
export function PosClientShell({ children }: { children: ReactNode }) {
  return (
    <RequireAuth
      allowRoles={["owner", "manager", "supervisor", "staff"]}
      loginRedirect="/pin"
    >
      <QueryProvider>
        <PosOuterShell>{children}</PosOuterShell>
      </QueryProvider>
    </RequireAuth>
  );
}

function PosOuterShell({ children }: { children: ReactNode }) {
  const { session } = useSession();
  if (!session) return null;

  return (
    <div className="flex h-screen flex-col bg-neutral-50">
      <OfflineBanner />
      <header className="flex h-16 items-center justify-between border-b border-neutral-200 bg-white px-6 shadow-sm touch:h-14 touch:px-4">
        <span className="text-lg font-bold text-mahakan-green-900 touch:text-base">
          Mahakan POS
        </span>
        <div className="flex items-center gap-3 touch:gap-2">
          <span className="text-sm text-neutral-700 touch:text-xs">
            {session.user.name}{" "}
            <span className="text-neutral-500 capitalize">
              ({session.user.role})
            </span>
          </span>
          <WorkspaceSwitcher current="pos" role={session.user.role} />
          <FullscreenToggle />
        </div>
      </header>
      {children}
    </div>
  );
}
