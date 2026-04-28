"use client";

import {
  ClipboardList,
  FileText,
  History,
  LayoutGrid,
  LogOut,
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

export function PosLeftNav({
  activeTab,
  onTabChange,
  onLogout,
  cashierBadge,
  queueBadge,
  openBillsBadge,
}: PosLeftNavProps) {
  return (
    <nav
      aria-label="Navigasi POS"
      className="flex w-20 shrink-0 flex-col items-center justify-between border-r border-neutral-200 bg-white py-4 lg:w-24"
    >
      <div className="flex flex-col items-center gap-2">
        <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-mahakan-green-700 text-white text-xs font-bold">
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
            />
          );
        })}
      </div>
      <NavButton label="Keluar" Icon={LogOut} active={false} onClick={onLogout} />
    </nav>
  );
}

function NavButton({
  label,
  Icon,
  active,
  onClick,
  badge,
}: {
  label: string;
  Icon: LucideIcon;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium uppercase tracking-wider transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-2",
        active
          ? "bg-mahakan-green-100 text-mahakan-green-900"
          : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900",
      )}
    >
      <Icon className="size-5" aria-hidden />
      <span>{label}</span>
      {badge !== undefined && badge > 0 ? (
        <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-mahakan-green-700 text-[10px] font-bold text-white">
          {badge > 9 ? "9+" : badge}
        </span>
      ) : null}
    </button>
  );
}
