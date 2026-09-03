"use client";

import { useEffect, useState } from "react";
import {
  ClipboardList,
  Coins,
  FileText,
  History,
  Home,
  Landmark,
  LayoutGrid,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { hasPermission, type Permission, type Role } from "@/lib/auth/rbac";
import { cn } from "@/lib/utils";

export type PosTab =
  | "dashboard"
  | "cashier"
  | "open_bills"
  | "queue"
  | "history"
  | "shifts"
  | "petty_cash"
  | "kas"
  | "goods_receive"
  | "settings";

interface PosLeftNavProps {
  activeTab: PosTab;
  onTabChange: (tab: PosTab) => void;
  onLogout: () => void;
  /** Role of current user — used to filter role-gated tabs. */
  role: Role;
  /** Optional badge count for cashier tab (drafts count, etc.) */
  cashierBadge?: number;
  /** Optional badge for queue tab (pending paid transactions). */
  queueBadge?: number;
  /** Optional badge for open_bills tab (unpaid transactions). */
  openBillsBadge?: number;
  /** Optional badge for kas tab (pending deposits awaiting verify). */
  kasBadge?: number;
  /** Sesi AE-224 — saklar menu Petty Cash dari pengaturan outlet.
   * undefined/false = disembunyikan. */
  pettyCashEnabled?: boolean;
}

interface TabConfig {
  key: PosTab;
  label: string;
  Icon: LucideIcon;
  /** Permission required to see this tab. Undefined = visible to all roles. */
  gate?: Permission;
  /** Sesi AE-224 — menu yang butuh saklar outlet, bukan sekadar izin peran. */
  flag?: "pettyCash";
}

// Sesi AE-8 — tambah "kas" tab gated by cash_deposit.view (owner+manager+
// supervisor). Staff biasa tidak akan melihat tab ini.
const TABS: TabConfig[] = [
  /* Sesi AE-62ah — Dashboard untuk kasir lihat progress target +
   * top menu hari ini. Tidak butuh permission khusus (kasir-facing). */
  { key: "dashboard", label: "Dashboard", Icon: Home },
  { key: "cashier", label: "Kasir", Icon: LayoutGrid },
  { key: "open_bills", label: "Bill Aktif", Icon: FileText },
  { key: "queue", label: "Pesanan", Icon: ClipboardList },
  { key: "history", label: "Riwayat", Icon: History },
  { key: "shifts", label: "Shift", Icon: Wallet },
  /* Sesi AE-224 — Petty Cash disembunyikan sejak owner mematikannya. Entrinya
   * sengaja DIBIARKAN di sini, bukan dihapus: fiturnya masih utuh dan tinggal
   * dinyalakan lagi dari Pengaturan setelah audit kas selesai. */
  { key: "petty_cash", label: "Petty Cash", Icon: Coins, flag: "pettyCash" },
  { key: "kas", label: "Kas", Icon: Landmark, gate: "cash_deposit.view" },
  // Sesi AE-173 — Terima Barang (GR) dari PO. Staff bisa nerima kiriman.
  {
    key: "goods_receive",
    label: "Terima Barang",
    Icon: Truck,
    gate: "purchase.goods_receive",
  },
  { key: "settings", label: "Pengaturan", Icon: Settings },
];

const COLLAPSED_STORAGE_KEY = "mahakan-pos.sidebar-collapsed-v1";

/** Per-device persisted preference. Default to collapsed at <1024px (tablet)
 * so cart/main content gets max width. User can manually expand and choice
 * persists. */
function useSidebarCollapsed(): [boolean, (next: boolean) => void] {
  // Default ke collapsed (tablet-first); tapi useEffect override dari
  // localStorage atau viewport-based default kalau belum pernah set.
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(COLLAPSED_STORAGE_KEY);
      if (stored === "1" || stored === "0") {
        /* eslint-disable react-hooks/set-state-in-effect */
        setCollapsed(stored === "1");
        /* eslint-enable react-hooks/set-state-in-effect */
        return;
      }
      // No stored preference: default = collapsed di tablet (<1280px), expanded di desktop.
      const isTablet =
        typeof window !== "undefined" && window.innerWidth < 1280;
      setCollapsed(isTablet);
    } catch {
      // localStorage might be blocked
    }
  }, []);

  function update(next: boolean) {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  }

  return [collapsed, update];
}

export function PosLeftNav({
  activeTab,
  onTabChange,
  onLogout,
  role,
  cashierBadge,
  queueBadge,
  openBillsBadge,
  kasBadge,
  pettyCashEnabled = false,
}: PosLeftNavProps) {
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const visibleTabs = TABS.filter((t) => {
    if (t.gate && !hasPermission(role, t.gate)) return false;
    if (t.flag === "pettyCash" && !pettyCashEnabled) return false;
    return true;
  });
  return (
    <nav
      aria-label="Navigasi POS"
      className={cn(
        "flex shrink-0 flex-col items-center border-r border-neutral-200 bg-white py-2 transition-[width] duration-200",
        collapsed ? "w-16 sm:w-20 lg:w-24" : "w-28 sm:w-32 lg:w-36",
      )}
    >
      <div className="flex w-full flex-col items-center gap-1.5 px-1">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Perlebar menu" : "Persempit menu"}
          title={collapsed ? "Perlebar menu" : "Persempit menu"}
          className={cn(
            "flex size-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-2",
          )}
        >
          <ToggleIcon className="size-4" aria-hidden />
        </button>
        <div className="mb-1 flex size-9 items-center justify-center rounded-lg bg-mahakan-green-700 text-white text-xs font-bold">
          MK
        </div>
      </div>
      {/* Items scrollable so tab kecil (Galaxy Tab landscape ~600px height)
       * tidak kepotong; logout tetap visible di bawah via flex layout. */}
      <div className="flex w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto px-1 py-1">
        {visibleTabs.map((tab) => {
          const badge =
            tab.key === "cashier"
              ? cashierBadge
              : tab.key === "queue"
                ? queueBadge
                : tab.key === "open_bills"
                  ? openBillsBadge
                  : tab.key === "kas"
                    ? kasBadge
                    : undefined;
          return (
            <NavButton
              key={tab.key}
              label={tab.label}
              Icon={tab.Icon}
              active={activeTab === tab.key}
              onClick={() => onTabChange(tab.key)}
              badge={badge}
              collapsed={collapsed}
            />
          );
        })}
      </div>
      <div className="w-full shrink-0 border-t border-neutral-100 px-1 pt-1.5">
        <NavButton
          label="Keluar"
          Icon={LogOut}
          active={false}
          onClick={onLogout}
          collapsed={collapsed}
        />
      </div>
    </nav>
  );
}

function NavButton({
  label,
  Icon,
  active,
  onClick,
  badge,
  collapsed,
}: {
  label: string;
  Icon: LucideIcon;
  active: boolean;
  onClick: () => void;
  badge?: number;
  collapsed: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-medium uppercase tracking-wider transition-all",
        collapsed ? "h-14 w-14" : "h-14 w-full max-w-[7rem]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-2",
        active
          ? "bg-mahakan-green-100 text-mahakan-green-900"
          : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900",
      )}
    >
      <Icon className="size-5 shrink-0" aria-hidden />
      {collapsed ? (
        <span className="sr-only">{label}</span>
      ) : (
        <span className="max-w-full truncate px-1">{label}</span>
      )}
      {badge !== undefined && badge > 0 ? (
        <span
          className={cn(
            "absolute flex size-5 items-center justify-center rounded-full bg-mahakan-green-700 text-[10px] font-bold text-white",
            collapsed ? "right-1 top-1" : "right-2 top-1",
          )}
        >
          {badge > 9 ? "9+" : badge}
        </span>
      ) : null}
    </button>
  );
}
