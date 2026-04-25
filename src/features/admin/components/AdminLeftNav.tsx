"use client";

import {
  BarChart3,
  Coffee,
  LayoutDashboard,
  LogOut,
  Settings,
  Users,
  Wallet,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Role } from "@/mocks/types";

export type AdminSection =
  | "dashboard"
  | "menu"
  | "staff"
  | "shifts"
  | "cash"
  | "reports"
  | "settings";

interface AdminLeftNavProps {
  active: AdminSection;
  onChange: (section: AdminSection) => void;
  onLogout: () => void;
  /** Used to hide owner-only sections from manager. */
  role: Role;
}

interface NavItem {
  key: AdminSection;
  label: string;
  Icon: LucideIcon;
  /** If true, only Owner can see. */
  ownerOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { key: "menu", label: "Menu", Icon: Coffee },
  { key: "staff", label: "Staff", Icon: Users },
  { key: "shifts", label: "Shifts", Icon: Receipt },
  { key: "cash", label: "Kas", Icon: Wallet },
  { key: "reports", label: "Laporan", Icon: BarChart3 },
  { key: "settings", label: "Settings", Icon: Settings },
];

export function AdminLeftNav({
  active,
  onChange,
  onLogout,
  role,
}: AdminLeftNavProps) {
  const items = NAV_ITEMS.filter(
    (item) => !item.ownerOnly || role === "owner",
  );

  return (
    <nav
      aria-label="Navigasi back office"
      className="flex w-56 shrink-0 flex-col justify-between border-r border-neutral-200 bg-white py-4"
    >
      <div className="space-y-0.5 px-3">
        <div className="mb-3 flex items-center gap-2 px-3 py-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-mahakan-green-700 text-xs font-bold text-white">
            MK
          </div>
          <div>
            <p className="text-sm font-semibold text-mahakan-green-900">
              Mahakan
            </p>
            <p className="text-xs text-neutral-500">Back Office</p>
          </div>
        </div>
        {items.map((item) => (
          <NavLink
            key={item.key}
            label={item.label}
            Icon={item.Icon}
            active={active === item.key}
            onClick={() => onChange(item.key)}
          />
        ))}
      </div>
      <div className="px-3">
        <NavLink label="Keluar" Icon={LogOut} active={false} onClick={onLogout} />
      </div>
    </nav>
  );
}

function NavLink({
  label,
  Icon,
  active,
  onClick,
}: {
  label: string;
  Icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-1",
        active
          ? "bg-mahakan-green-100 text-mahakan-green-900"
          : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span>{label}</span>
    </button>
  );
}
