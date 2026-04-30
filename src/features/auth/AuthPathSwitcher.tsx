"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Segmented control for switching between POS PIN login and Back Office
 * email login. Owner-feedback (sesi J): the small footer link "Mau ke Back
 * Office? Login dengan email" was easily missed; users got confused which
 * path to take. This puts the choice front-and-center.
 *
 * Routes:
 *   /pin    → POS / Kasir (PIN avatar)
 *   /login  → Back Office (email + password)
 */
export function AuthPathSwitcher() {
  const pathname = usePathname();
  const isPin = pathname?.startsWith("/pin") ?? false;
  const isLogin = pathname?.startsWith("/login") ?? false;

  return (
    <div className="mx-auto w-full max-w-md">
      <div
        role="tablist"
        aria-label="Pilih mode login"
        className="grid grid-cols-2 gap-1 rounded-xl border border-neutral-200 bg-neutral-100/60 p-1 shadow-sm"
      >
        <Tab
          href="/pin"
          active={isPin}
          icon={<ShoppingBag className="size-4" aria-hidden />}
          title="POS / Kasir"
          subtitle="PIN · Semua role"
        />
        <Tab
          href="/login"
          active={isLogin}
          icon={<LayoutDashboard className="size-4" aria-hidden />}
          title="Back Office"
          subtitle="Email · Owner / Manager"
        />
      </div>
    </div>
  );
}

interface TabProps {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}

function Tab({ href, active, icon, title, subtitle }: TabProps) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      className={cn(
        "flex flex-col items-center gap-0.5 rounded-lg px-3 py-2.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
        active
          ? "bg-white text-mahakan-green-900 shadow-sm ring-1 ring-mahakan-green-700/20"
          : "text-neutral-600 hover:bg-white/70 hover:text-neutral-900",
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-semibold">
        {icon}
        {title}
      </span>
      <span
        className={cn(
          "text-[11px] sm:text-xs",
          active ? "text-mahakan-green-700" : "text-neutral-500",
        )}
      >
        {subtitle}
      </span>
    </Link>
  );
}
