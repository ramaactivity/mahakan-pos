import Image from "next/image";
import type { ReactNode } from "react";
import { AuthPathSwitcher } from "@/features/auth/AuthPathSwitcher";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    // min-h-svh = small viewport height (avoids iOS safari URL-bar trap).
    // No max-h / overflow-hidden — content scrolls naturally if it exceeds
    // viewport. Vertically centered when fits, top-aligned when taller.
    <div className="flex min-h-svh flex-col items-center justify-center bg-gradient-to-b from-mahakan-green-50/60 via-neutral-50 to-white px-4 py-4 sm:py-6">
      <div className="flex w-full max-w-md flex-col items-stretch gap-4 sm:gap-5">
        {/* Compact logo header */}
        <header className="flex flex-col items-center gap-1.5">
          <Image
            src="/assets/logo/Logo_Mahakan_Hijau_Transparent.png"
            alt="Mahakan Coffee & Space"
            width={120}
            height={170}
            priority
            className="h-12 w-auto sm:h-14"
          />
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Mahakan Coffee &amp; Space
          </p>
        </header>

        {/* Path switcher — POS / Back Office */}
        <AuthPathSwitcher />

        {/* Page content (PIN form / Email form) */}
        <main className="w-full">{children}</main>
      </div>
    </div>
  );
}
