"use client";

import {
  AlertTriangle,
  Banknote,
  BarChart3,
  Bike,
  BookOpen,
  Briefcase,
  CheckSquare,
  ShoppingCart,
  Clock,
  Coffee,
  FileText,
  Heart,
  Landmark,
  LayoutDashboard,
  LogOut,
  Package,
  ScrollText,
  ShieldCheck,
  Settings,
  Sparkles,
  Truck,
  Users,
  Wallet,
  Receipt,
  History,
  HandCoins,
  Wallet as WalletIcon,
  type LucideIcon,
} from "lucide-react";
import { Fragment } from "react";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/auth";

export type AdminSection =
  | "dashboard"
  | "approvals"
  | "menu"
  | "cogs_variance"
  | "inventory"
  | "suppliers"
  | "purchase_requests"
  | "purchasing"
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
  | "aggregator_online"
  | "promos"
  | "reports"
  | "audit"
  | "journal_retry"
  | "investors"
  | "internal_debts"
  | "operasional_checklist"
  | "nota_archive"
  | "settings";

interface AdminLeftNavProps {
  active: AdminSection;
  onChange: (section: AdminSection) => void;
  onLogout: () => void;
  /** Used to hide owner-only sections from manager. */
  role: Role;
  /** Sesi AE-123 — optional badge counts per section (mis. pending setoran).
   * Render kalau > 0. Pass dari AdminShell yang fetch via React Query. */
  badges?: Partial<Record<AdminSection, number>>;
}

interface NavItem {
  key: AdminSection;
  label: string;
  Icon: LucideIcon;
  /** If true, only Owner can see. */
  ownerOnly?: boolean;
  /** Sesi AE-222 — sub-label kecil yang dirender di atas item ini, sebagai
   * pemisah di dalam group yang isinya banyak (mis. Finance). Hanya muncul
   * kalau item ini yang pertama membawa sub-label tsb setelah difilter role,
   * jadi tidak pernah ada judul menggantung tanpa isi. */
  sub?: string;
}

interface NavGroup {
  /** Uppercase label rendered above the group. Empty string = no header
   * (e.g., first/utility group). */
  heading: string;
  items: NavItem[];
}

/**
 * Phase 9.1 (sesi AB) — group sidebar items per kategori sesuai spec owner
 * (sesi AA handover). Group memberi visual hierarchy supaya owner/manager
 * tidak perlu memindai 25 item datar.
 *
 * Sesi AE-222 — owner directive 2026-08-29: Finance naik ke posisi 2 (tepat
 * setelah Operasi) karena itu menu yang paling sering dibuka owner; Inventaris
 * + Menu digabung jadi satu group; Cashflow dan Modal & Dividen dilebur MASUK
 * Finance. Karena Finance jadi 12 item, isinya dipecah pakai sub-label
 * (Kas & Setoran / Pembukuan / Modal & Dividen) — group tetap satu, cuma
 * dikasih titik istirahat visual.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    heading: "Operasi",
    items: [
      { key: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
      /* Sesi AE-160 — Pusat Persetujuan: void/refund/correction/rebalance/
       * entry-change pending+history dalam satu queue + dual-mode approve
       * (kode atau direct owner). Badge angka pending total. */
      { key: "approvals", label: "Persetujuan", Icon: ShieldCheck },
      { key: "shifts", label: "Shifts", Icon: Receipt },
    ],
  },
  {
    heading: "Finance",
    items: [
      { key: "finance", label: "Keuangan", Icon: Banknote },
      { key: "balance_account", label: "Saldo Akun", Icon: WalletIcon },
      { key: "reports", label: "Laporan", Icon: BarChart3 },
      {
        key: "setoran_tunai",
        label: "Setoran Tunai",
        Icon: Landmark,
        sub: "Kas & Setoran",
      },
      { key: "cash", label: "Kas", Icon: Wallet },
      /* Sesi AE-132 — Arsip foto nota staff (dokumentasi murni, tidak
       * terikat finance). Ikut Kas & Setoran karena overlap konseptual. */
      { key: "nota_archive", label: "Arsip Nota", Icon: FileText },
      {
        key: "accounting",
        label: "Akuntansi",
        Icon: BookOpen,
        sub: "Pembukuan",
      },
      /* Sesi AE-77 — Laporan online order (GoFood/GrabFood/ShopeeFood)
       * + cashless (QRIS/EDC). Drilldown per-order kalau import CSV. */
      { key: "aggregator_online", label: "Online & Cashless", Icon: Bike },
      { key: "reconciliation", label: "Rekonsiliasi", Icon: History },
      /* Sesi AE-62w — antrian retry untuk failed journal hooks.
       * Owner trigger retry / abandon. Manager view-only (via RBAC). */
      { key: "journal_retry", label: "Antrian Jurnal", Icon: AlertTriangle },
      /* Sesi AE-63 — Investor + Pengelola + distribusi dividen bulanan. */
      {
        key: "investors",
        label: "Investor",
        Icon: HandCoins,
        ownerOnly: false,
        sub: "Modal & Dividen",
      },
      /* Sesi AE-180 — Hutang Internal (Talangan Owner/Pengelola). Halaman
       * terpisah dari Investor (owner directive). */
      { key: "internal_debts", label: "Hutang Internal", Icon: Landmark },
    ],
  },
  {
    heading: "Inventaris & Menu",
    items: [
      { key: "inventory", label: "Inventory", Icon: Package },
      { key: "cogs_variance", label: "Persediaan Bahan Baku", Icon: Package },
      { key: "purchasing", label: "Purchasing", Icon: ShoppingCart },
      { key: "suppliers", label: "Supplier", Icon: Truck },
      { key: "menu", label: "Menu", Icon: Coffee },
    ],
  },
  {
    heading: "HR",
    items: [
      { key: "staff", label: "Staff", Icon: Users },
      { key: "employees", label: "Karyawan", Icon: Briefcase },
      { key: "hr_operations", label: "HR Operations", Icon: Clock },
      /* Sesi AE-131 — Owner/Manager mengelola daftar tugas operasional
       * (daily/weekly/monthly) untuk staff. */
      {
        key: "operasional_checklist",
        label: "Checklist Operasional",
        Icon: CheckSquare,
      },
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
  badges,
}: AdminLeftNavProps) {
  const visibleGroups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((it) => !it.ownerOnly || role === "owner"),
  })).filter((g) => g.items.length > 0);

  return (
    <nav
      aria-label="Navigasi back office"
      // Sesi AE-131 — fix scroll bug: drawer wrapper di AdminShell (post AE-126)
      // memutus auto-stretch flex parent, jadi nav perlu h-full eksplisit supaya
      // flex-1 overflow-y-auto di bawah punya height constraint dan bisa scroll.
      className="flex h-full w-44 shrink-0 flex-col border-r border-neutral-200 bg-white py-3 sm:w-48 lg:w-56"
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
      {/* Scrollable items — 25 section, di tablet kecil pasti overflow.
       * Heading group + sub-label di dalam Finance kasih visual rest supaya
       * daftar panjang tetap bisa dipindai. */}
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
            {group.items.map((item, ii) => {
              /* Sesi AE-222 — sub-label dirender saat berganti dari item
               * sebelumnya. Dihitung SESUDAH filter role, jadi kalau item
               * pertama sebuah sub disembunyikan RBAC, judulnya pindah ke
               * item berikutnya — bukan jadi judul kosong. */
              const prevSub = ii > 0 ? group.items[ii - 1]?.sub : undefined;
              const showSub = item.sub && item.sub !== prevSub;
              return (
                <Fragment key={item.key}>
                  {showSub ? (
                    <p className="px-3 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wide text-neutral-400/90">
                      {item.sub}
                    </p>
                  ) : null}
                  <NavLink
                    label={item.label}
                    Icon={item.Icon}
                    active={active === item.key}
                    badge={badges?.[item.key]}
                    onClick={() => onChange(item.key)}
                  />
                </Fragment>
              );
            })}
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-neutral-100 px-3 pt-2">
        <NavLink
          label="Keluar"
          Icon={LogOut}
          active={false}
          onClick={onLogout}
        />
      </div>
    </nav>
  );
}

function NavLink({
  label,
  Icon,
  active,
  badge,
  onClick,
}: {
  label: string;
  Icon: LucideIcon;
  active: boolean;
  /** Sesi AE-123 — badge count opsional (mis. setoran pending). */
  badge?: number;
  onClick: () => void;
}) {
  const showBadge = typeof badge === "number" && badge > 0;
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
      <span className="flex-1 text-left">{label}</span>
      {showBadge ? (
        <span
          aria-label={`${badge} pending`}
          className={cn(
            "inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none",
            active
              ? "bg-mahakan-green-700 text-white"
              : "bg-warning-500 text-white",
          )}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Sesi AE-213 — label menu yang dipakai penahan error per-bagian
 * (`SectionErrorBoundary`) supaya pesannya menyebut nama menu yang owner
 * lihat di sidebar, bukan kode internalnya ("accounting").
 */
export function adminSectionLabel(section: AdminSection): string {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (item.key === section) return item.label;
    }
  }
  return section;
}
