"use client";

import type { ReactNode } from "react";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { useSession } from "@/features/auth/SessionProvider";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth allowRoles={["owner", "manager"]}>
      <AdminOuterShell>{children}</AdminOuterShell>
    </RequireAuth>
  );
}

function AdminOuterShell({ children }: { children: ReactNode }) {
  const { session } = useSession();
  if (!session) return null;

  return (
    <div className="flex h-screen flex-col bg-neutral-50">
      <header className="flex h-16 items-center justify-between border-b border-neutral-200 bg-white px-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-mahakan-green-900">
            Mahakan POS
          </span>
          <span className="rounded-md bg-mahakan-green-100 px-2 py-0.5 text-xs font-medium uppercase tracking-wider text-mahakan-green-800">
            Back Office
          </span>
        </div>
        <span className="text-sm text-neutral-700">
          {session.user.name}{" "}
          <span className="text-neutral-500 capitalize">
            ({session.user.role})
          </span>
        </span>
      </header>
      {children}
    </div>
  );
}
