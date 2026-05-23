"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LayoutDashboard, ShoppingBag, Users } from "lucide-react";
import { Suspense } from "react";
import { cn } from "@/lib/utils";

/**
 * Segmented control untuk switching antara POS PIN login dan Back Office
 * email login. Owner-feedback (sesi J): the small footer link "Mau ke Back
 * Office? Login dengan email" was easily missed; users got confused which
 * path to take. This puts the choice front-and-center.
 *
 * Sesi AE-17 — staff /m context. Kalau callbackUrl=/m, switcher hide jadi
 * single-purpose badge "Login Karyawan" supaya staff yang dateng dari
 * /m link langsung paham ini login mereka, bukan dual POS/BackOffice
 * switcher yang confusing.
 *
 * Routes:
 *   /pin    → POS / Kasir (PIN avatar)
 *   /login  → Back Office (email + password)
 */
export function AuthPathSwitcher() {
  return (
    <Suspense fallback={null}>
      <AuthPathSwitcherInner />
    </Suspense>
  );
}

function AuthPathSwitcherInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams?.get("callbackUrl") ?? "";
  /* Sesi AE-127 — `?next=` ditambah oleh RequireAuth saat redirect dari
   * /dashboard atau /pos. Kalau ada `next`, anggap user sudah punya
   * target spesifik → hide switcher (langsung tampilkan form). */
  const nextParam = searchParams?.get("next") ?? "";
  const isStaffContext = callbackUrl.startsWith("/m");
  const isPin = pathname?.startsWith("/pin") ?? false;
  const isLogin = pathname?.startsWith("/login") ?? false;

  /* Sesi AE-127 — user di-redirect dari context spesifik (/dashboard, /pos).
   * Hide switcher karena user tidak butuh pilih lagi — URL tujuan sudah
   * jelas. Mereka pasti owner (kalau dari /dashboard) atau kasir (dari /pos). */
  if (nextParam) return null;

  // Sesi AE-17 — staff context: render single badge instead of switcher.
  if (isStaffContext && isPin) {
    return (
      <div className="mx-auto w-full max-w-md">
        <div className="flex items-center gap-3 rounded-xl border border-mahakan-green-700/30 bg-mahakan-green-50 p-3 shadow-sm">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-mahakan-green-700 text-white">
            <Users className="size-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-mahakan-green-900">
              Login Karyawan
            </p>
            <p className="text-[11px] text-neutral-700">
              Akses Tools Karyawan: Absensi, Jadwal, Opname, PO
            </p>
          </div>
        </div>
      </div>
    );
  }

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
