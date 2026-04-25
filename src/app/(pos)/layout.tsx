"use client";

import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { useSession } from "@/features/auth/SessionProvider";
import { useRouter } from "next/navigation";

export default function PosLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth allowRoles={["owner", "manager", "staff"]} loginRedirect="/pin">
      <PosShell>{children}</PosShell>
    </RequireAuth>
  );
}

function PosShell({ children }: { children: ReactNode }) {
  const { session, logout } = useSession();
  const router = useRouter();

  if (!session) return null;

  async function onLogout() {
    await logout();
    router.replace("/pin");
  }

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="flex h-16 items-center justify-between border-b border-neutral-200 bg-white px-4 shadow-sm sm:px-6">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-mahakan-green-900">
            Mahakan POS
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-neutral-700">
            {session.user.name}{" "}
            <span className="text-neutral-500">({session.user.role})</span>
          </span>
          <Button variant="ghost" size="sm" onClick={onLogout}>
            <LogOut className="size-4" aria-hidden /> Keluar
          </Button>
        </div>
      </header>
      <main className="flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
