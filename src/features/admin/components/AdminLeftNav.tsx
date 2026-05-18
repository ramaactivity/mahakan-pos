"use client";

import {
  AlertTriangle,
  Banknote,
  BarChart3,
  BookOpen,
  Briefcase,
  ClipboardList,
  Clock,
  Coffee,
  Heart,
  Landmark,
  LayoutDashboard,
  LogOut,
  Package,
  ScrollText,
  Settings,
  Sparkles,
  Truck,
  Users,
  Wallet,
  Receipt,
  History,
  Wallet as WalletIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/auth";

export type AdminSection =
  | "dashboard"
  | "menu"
  | "inventory"
  | "suppliers"
  | "purchase_requests"
  | "customers"
  | "staff"
  | "employees"
  | "hr_operations"
  | "shifts"
  | "cash"
  | "setoran_tunai"
  | "finance"
  | "accounting"
  | "balance_account"
  | "reconciliation"
  | "promos"
  | "reports"
  | "audit"
  | "journal_retry"
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

interface NavGroup {
  /** Uppercase label rendered above the group. Empty string = no header
   * (e.g., first/utility group). */
  heading: string;
  items: NavItem[];
}

/**
 * Phase 9.1 (sesi AB) — group sidebar items per kategori sesuai spec owner
 * (sesi AA handover). 19 items dalam 8 group untuk visual hierarchy yang
 * jelas, mengurangi cognitive load saat owner/manager scan menu.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    heading: "Operasi",
    items: [
      { key: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
      { key: "shifts", label: "Shifts", Icon: Receipt },
    ],
  },
  {
    heading: "Inventaris",
    items: [
      { key: "inventory", label: "Inventory", Icon: Package },
      { key: "suppliers", label: "Supplier", Icon: Truck },
      { key: "purchase_requests", label: "Permintaan Belanja", Icon: ClipboardList },
    ],
  },
  {
    heading: "Menu",
    items: [{ key: "menu", label: "Menu", Icon: Coffee }],
  },
  {
    heading: "Cashflow",
    items: [
      { key: "setoran_tunai", label: "Setoran Tunai", Icon: Landmark },
      { key: "cash", label: "Kas", Icon: Wallet },
    ],
  },
  {
    heading: "HR",
    items: [
      { key: "staff", label: "Staff", Icon: Users },
      { key: "employees", label: "Karyawan", Icon: Briefcase },
      { key: "hr_operations", label: "HR Operations", Icon: Clock },
    ],
  },
  {
    heading: "Finance",
    items: [
      { key: "finance", label: "Keuangan", Icon: Banknote },
      { key: "balance_account", label: "Saldo Akun", Icon: WalletIcon },
      { key: "accounting", label: "Akuntansi", Icon: BookOpen },
      { key: "reports", label: "Laporan", Icon: BarChart3 },
      { key: "reconciliation", label: "Rekonsiliasi", Icon: History },
      /* Sesi AE-62w — antrian retry untuk failed journal hooks.
       * Owner trigger retry / abandon. Manager view-only (via RBAC). */
      { key: "journal_retry", label: "Antrian Jurnal", Icon: AlertTriangle },
    ],
  },
  {
    heading: "Marketing",
    items: [
      { key: "promos", label: "Promo", Icon: Sparkles },
      { key: "customers", label: "Member", Icon: Heart },
    ],
  },
  {
    heading: "Sistem",
    items: [
      { key: "settings", label: "Settings", Icon: Settings },
      /* Sesi AE-62u — audit visible juga buat manager+supervisor (filtered
       * ke staff actions saja). Owner masih lihat full audit log. */
      { key: "audit", label: "Audit Log", Icon: ScrollText },
    ],
  },
];

export function AdminLeftNav({
  active,
  onChange,
  onLogout,
  role,
}: AdminLeftNavProps) {
  const visibleGroups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((it) => !it.ownerOnly || role === "owner"),
  })).filter((g) => g.items.length > 0);

  return (
    <nav
      aria-label="Navigasi back office"
      className="flex w-44 shrink-0 flex-col border-r border-neutral-200 bg-white py-3 sm:w-48 lg:w-56"
    >
      <div className="mb-2 flex shrink-0 items-center gap-2 px-4 py-1">
        <div className="flex size-8 items-center justify-center rounded-md bg-mahakan-green-700 text-xs font-bold text-white">
          MK
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-mahakan-green-900">
            Mahakan
          </p>
          <p className="text-xs text-neutral-500">Back Office</p>
        </div>
      </div>
      {/* Scrollable items — 19 section dengan tablet kecil bisa overflow.
       * Section headers (Operasi/Inventaris/dll) bantu kasih visual rest +
       * cognitive grouping. */}
      <div className="flex-1 overflow-y-auto px-3 py-1">
        {visibleGroups.map((group, gi) => (
          <div
            key={group.heading}
            className={cn(
              "space-y-0.5",
              gi > 0 ? "mt-3 border-t border-neutral-100 pt-3" : null,
            )}
          >
            <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              {group.heading}
            </p>
            {group.items.map((item) => (
              <NavLink
                key={item.key}
                label={item.label}
                Icon={item.Icon}
                active={active === item.key}
                onClick={() => onChange(item.key)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-neutral-100 px-3 pt-2">
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
