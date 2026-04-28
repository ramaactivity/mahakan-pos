"use client";

import Link from "next/link";
import { LayoutDashboard, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/auth";

interface WorkspaceSwitcherProps {
  current: "admin" | "pos";
  role: Role;
  className?: string;
}

/**
 * Quick-toggle button between back office (/dashboard) and POS (/pos).
 *
 * Owner often supervises kasir + checks reports in the same shift; Manager
 * does opening/closing in POS but adjusts menu/inventory in admin. Single
 * tap from topbar instead of typing the URL or relogging.
 *
 * Hidden for Staff — they can't access /dashboard anyway.
 */
export function WorkspaceSwitcher({
  current,
  role,
  className,
}: WorkspaceSwitcherProps) {
  if (role === "staff") return null;

  const goingToPos = current === "admin";
  const href = goingToPos ? "/pos" : "/dashboard";
  const label = goingToPos ? "Buka POS" : "Back Office";
  const Icon = goingToPos ? ShoppingBag : LayoutDashboard;

  return (
    <Link
      href={href}
      aria-label={`Pindah ke ${label}`}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-700 transition-colors hover:border-mahakan-green-700 hover:bg-mahakan-green-50 hover:text-mahakan-green-900",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-2",
        className,
      )}
    >
      <Icon className="size-4" aria-hidden />
      <span>{label}</span>
    </Link>
  );
}
