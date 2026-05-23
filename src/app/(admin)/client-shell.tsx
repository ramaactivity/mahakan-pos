"use client";

import type { ReactNode } from "react";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { WorkspaceSwitcher } from "@/components/ui/WorkspaceSwitcher";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { useSession } from "@/features/auth/SessionProvider";
import { QueryProvider } from "@/features/_shared/QueryProvider";

/**
 * Sesi AE-126 — Client shell untuk admin route group. Sebelumnya inline
 * di layout.tsx, sekarang split jadi 2 file:
 *   - layout.tsx (server) export metadata + manifest
 *   - client-shell.tsx (client) render OuterShell + auth + query
 */
export function AdminClientShell({ children }: { children: ReactNode }) {
  return (
    <RequireAuth allowRoles={["owner", "manager", "supervisor"]}>
      <QueryProvider>
        <AdminOuterShell>{children}</AdminOuterShell>
      </QueryProvider>
    </RequireAuth>
  );
}

function AdminOuterShell({ children }: { children: ReactNode }) {
  const { session } = useSession();
  if (!session) return null;

  return (
    <div className="flex h-screen flex-col bg-neutral-50">
      <OfflineBanner />
      {/* Sesi AE-126 — Header responsif. Padding lebih kecil di mobile
       * (px-3) supaya user info + workspace switcher tetap fit. */}
      <header className="flex h-16 items-center justify-between border-b border-neutral-200 bg-white px-3 shadow-sm sm:px-6">
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="text-base font-bold text-mahakan-green-900 sm:text-lg">
            Mahakan POS
          </span>
          <span className="hidden rounded-md bg-mahakan-green-100 px-2 py-0.5 text-xs font-medium uppercase tracking-wider text-mahakan-green-800 sm:inline">
            Back Office
          </span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden text-sm text-neutral-700 sm:inline">
            {session.user.name}{" "}
            <span className="text-neutral-500 capitalize">
              ({session.user.role})
            </span>
          </span>
          <WorkspaceSwitcher current="admin" role={session.user.role} />
        </div>
      </header>
      {children}
    </div>
  );
}
