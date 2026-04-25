"use client";

import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { useSession } from "@/features/auth/SessionProvider";
import { useRouter } from "next/navigation";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth allowRoles={["owner", "manager"]}>
      <AdminShell>{children}</AdminShell>
    </RequireAuth>
  );
}

function AdminShell({ children }: { children: ReactNode }) {
  const { session, logout } = useSession();
  const router = useRouter();

  if (!session) return null;

  async function onLogout() {
    await logout();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-neutral-200 bg-white px-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-mahakan-green-900">
            Mahakan POS
          </span>
          <span className="rounded-md bg-mahakan-green-100 px-2 py-0.5 text-xs font-medium uppercase tracking-wider text-mahakan-green-800">
            Back Office
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-neutral-700">
            {session.user.name}{" "}
            <span className="text-neutral-500">
              ({session.user.role})
            </span>
          </span>
          <Button variant="ghost" size="sm" onClick={onLogout}>
            <LogOut className="size-4" aria-hidden /> Logout
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  );
}
