"use client";

import { useEffect, useState } from "react";
import {
  ClipboardList,
  FileText,
  History,
  LayoutGrid,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type PosTab =
  | "cashier"
  | "open_bills"
  | "queue"
  | "history"
  | "shifts"
  | "settings";

interface PosLeftNavProps {
  activeTab: PosTab;
  onTabChange: (tab: PosTab) => void;
  onLogout: () => void;
  /** Optional badge count for cashier tab (drafts count, etc.) */
  cashierBadge?: number;
  /** Optional badge for queue tab (pending paid transactions). */
  queueBadge?: number;
  /** Optional badge for open_bills tab (unpaid transactions). */
  openBillsBadge?: number;
}

const TABS: Array<{ key: PosTab; label: string; Icon: LucideIcon }> = [
  { key: "cashier", label: "Kasir", Icon: LayoutGrid },
  { key: "open_bills", label: "Bill Aktif", Icon: FileText },
  { key: "queue", label: "Pesanan", Icon: ClipboardList },
  { key: "history", label: "Riwayat", Icon: History },
  { key: "shifts", label: "Shift", Icon: Wallet },
  { key: "settings", label: "Pengaturan", Icon: Settings },
];

const COLLAPSED_STORAGE_KEY = "mahakan-pos.sidebar-collapsed-v1";

/** Per-device persisted preference. Default expanded so labels are readable. */
function useSidebarCollapsed(): [boolean, (next: boolean) => void] {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(COLLAPSED_STORAGE_KEY);
      if (stored === "1") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCollapsed(true);
      }
    } catch {
      // localStorage might be blocked; default to expanded
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
  cashierBadge,
  queueBadge,
  openBillsBadge,
}: PosLeftNavProps) {
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <nav
      aria-label="Navigasi POS"
      className={cn(
        "flex shrink-0 flex-col items-center justify-between border-r border-neutral-200 bg-white py-3 transition-[width] duration-200",
        collapsed ? "w-20 lg:w-24" : "w-32 lg:w-36",
      )}
    >
      <div className="flex w-full flex-col items-center gap-2">
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
        <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-mahakan-green-700 text-white text-xs font-bold">
          MK
        </div>
        {TABS.map((tab) => {
          const badge =
            tab.key === "cashier"
              ? cashierBadge
              : tab.key === "queue"
                ? queueBadge
                : tab.key === "open_bills"
                  ? openBillsBadge
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
      <NavButton
        label="Keluar"
        Icon={LogOut}
        active={false}
        onClick={onLogout}
        collapsed={collapsed}
      />
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
        "relative flex flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium uppercase tracking-wider transition-all",
        collapsed ? "h-16 w-16" : "h-16 w-28",
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
