"use client";

import { useEffect, useState } from "react";
import { ClosingShiftView } from "./reports/ClosingShiftView";
import { DailySalesView } from "./reports/DailySalesView";
import { HppView } from "./reports/HppView";
import { ItemPerformanceView } from "./reports/ItemPerformanceView";
import { MenuEngineeringView } from "./reports/MenuEngineeringView";
import { PerBillView } from "./reports/PerBillView";
import { PnlView } from "./reports/PnlView";
import { PurchaseRollupView } from "./reports/PurchaseRollupView";
import { RefundVoidComplimentView } from "./reports/RefundVoidComplimentView";
import { SalesRangeView } from "./reports/SalesRangeView";
import { TargetsView } from "./reports/TargetsView";
import { TopCustomersView } from "./reports/TopCustomersView";
import type { Role } from "@/lib/auth";
import { cn } from "@/lib/utils";

type ReportTab =
  | "sales"
  | "range"
  | "closing_shift"
  | "per_bill"
  | "refund_void"
  | "items"
  | "matrix"
  | "members"
  | "pnl"
  | "hpp"
  | "purchase_rollup"
  | "targets";

interface ReportTabDef {
  key: ReportTab;
  label: string;
  ownerOnly?: boolean;
}

interface ReportGroup {
  heading: string;
  tabs: ReportTabDef[];
}

/* Sesi AE-55 — 3 group inline supaya 11 tab nggak desak satu baris.
 * Penjualan (operational, semua role) — Performa (analitik, semua + matrix
 * owner) — Owner (P&L, HPP, Target, Pembelanjaan + matrix owner only). */
const REPORT_GROUPS: ReportGroup[] = [
  {
    heading: "Penjualan",
    tabs: [
      { key: "sales", label: "Harian" },
      { key: "range", label: "Mingguan/Bulanan" },
      { key: "closing_shift", label: "Closing Shift" },
      { key: "per_bill", label: "Per-Bill" },
      { key: "refund_void", label: "Refund/Void/Komplimen" },
    ],
  },
  {
    heading: "Performa",
    tabs: [
      { key: "items", label: "Performa Item" },
      { key: "members", label: "Top Member" },
      { key: "matrix", label: "Matriks Menu", ownerOnly: true },
    ],
  },
  {
    heading: "Owner",
    tabs: [
      { key: "targets", label: "Target & Progress", ownerOnly: true },
      { key: "purchase_rollup", label: "Pembelanjaan" },
      { key: "hpp", label: "HPP/COGS", ownerOnly: true },
      { key: "pnl", label: "P&L", ownerOnly: true },
    ],
  },
];

/* Sesi AE-62ai — cross-section handover: caller (DashboardHome target
 * empty card CTA) set sessionStorage key sebelum navigate ke "reports",
 * lalu Section mount baca & clear. Mirror pattern setHrOperationsInitialTab. */
const INITIAL_TAB_STORAGE_KEY = "reports:initial-tab";

export function setReportsInitialTab(tab: ReportTab) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(INITIAL_TAB_STORAGE_KEY, tab);
}

interface ReportsSectionProps {
  viewerRole: Role;
}

export function ReportsSection({ viewerRole }: ReportsSectionProps) {
  const [tab, setTab] = useState<ReportTab>("sales");
  const isOwner = viewerRole === "owner";

  useEffect(() => {
    const stored = sessionStorage.getItem(INITIAL_TAB_STORAGE_KEY);
    if (stored) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setTab(stored as ReportTab);
      /* eslint-enable react-hooks/set-state-in-effect */
      sessionStorage.removeItem(INITIAL_TAB_STORAGE_KEY);
    }
  }, []);

  const visibleGroups = REPORT_GROUPS.map((g) => ({
    heading: g.heading,
    tabs: g.tabs.filter((t) => !t.ownerOnly || isOwner),
  })).filter((g) => g.tabs.length > 0);

  return (
    <div className="p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-mahakan-green-900">Laporan</h1>
        <p className="text-sm text-neutral-700">
          Penjualan, performa item, target, dan owner reports.
        </p>
      </header>

      <div className="flex flex-wrap gap-x-6 gap-y-3 border-b border-neutral-200 pb-3">
        {visibleGroups.map((group) => (
          <div key={group.heading} className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              {group.heading}
            </p>
            <div
              role="tablist"
              aria-label={`Tab grup ${group.heading}`}
              className="flex flex-wrap gap-1.5"
            >
              {group.tabs.map((t) => {
                const active = tab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTab(t.key)}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                      active
                        ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                        : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50",
                    )}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div>
        {tab === "sales" ? (
          <DailySalesView />
        ) : tab === "range" ? (
          <SalesRangeView />
        ) : tab === "closing_shift" ? (
          <ClosingShiftView />
        ) : tab === "per_bill" ? (
          <PerBillView />
        ) : tab === "refund_void" ? (
          <RefundVoidComplimentView />
        ) : tab === "items" ? (
          <ItemPerformanceView />
        ) : tab === "matrix" ? (
          <MenuEngineeringView />
        ) : tab === "members" ? (
          <TopCustomersView />
        ) : tab === "purchase_rollup" ? (
          <PurchaseRollupView />
        ) : tab === "hpp" ? (
          <HppView />
        ) : tab === "targets" ? (
          <TargetsView />
        ) : (
          <PnlView viewerRole={viewerRole} />
        )}
      </div>
    </div>
  );
}
