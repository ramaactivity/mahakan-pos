"use client";

import { useState } from "react";
import { DailySalesView } from "./reports/DailySalesView";
import { ItemPerformanceView } from "./reports/ItemPerformanceView";
import { PnlView } from "./reports/PnlView";
import type { Role } from "@/lib/auth";
import { cn } from "@/lib/utils";

type ReportTab = "sales" | "items" | "pnl";

interface ReportsSectionProps {
  viewerRole: Role;
}

export function ReportsSection({ viewerRole }: ReportsSectionProps) {
  const [tab, setTab] = useState<ReportTab>("sales");

  const TABS: Array<{ key: ReportTab; label: string; ownerOnly?: boolean }> = [
    { key: "sales", label: "Penjualan Harian" },
    { key: "items", label: "Performa Item" },
    { key: "pnl", label: "P&L (Owner)" },
  ];

  return (
    <div className="p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-mahakan-green-900">Laporan</h1>
        <p className="text-sm text-neutral-700">
          Penjualan harian, performa item, dan P&amp;L sederhana.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Reports tabs"
        className="flex gap-1 border-b border-neutral-200"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
              tab === t.key
                ? "border-mahakan-green-700 text-mahakan-green-900"
                : "border-transparent text-neutral-500 hover:text-neutral-900",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div>
        {tab === "sales" ? (
          <DailySalesView />
        ) : tab === "items" ? (
          <ItemPerformanceView />
        ) : (
          <PnlView viewerRole={viewerRole} />
        )}
      </div>
    </div>
  );
}
