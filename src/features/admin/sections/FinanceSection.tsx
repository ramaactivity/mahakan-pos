"use client";

import { useState } from "react";
import { Banknote } from "lucide-react";
import { BankSettlementView } from "./finance/BankSettlementView";
import { CashOnHandTile } from "./finance/CashOnHandTile";
import { DailySettlementView } from "./finance/DailySettlementView";
import { SetoranTunaiView } from "./finance/SetoranTunaiView";
import { ArusKasView } from "./finance/ArusKasView";
import { ReconciliationView } from "./finance/ReconciliationView";
import { HutangSurfacingView } from "./finance/HutangSurfacingView";
import { hasPermission } from "@/lib/auth/rbac";
import type { Role } from "@/lib/auth/rbac";
import { cn } from "@/lib/utils";

type FinanceTab =
  | "settlement"
  | "bank"
  | "deposits"
  | "cashflow"
  | "reconcile"
  | "hutang";

const TABS: Array<{
  key: FinanceTab;
  label: string;
  ownerOnly?: boolean;
}> = [
  { key: "settlement", label: "Ringkasan Shift" },
  { key: "bank", label: "Mutasi Bank" },
  { key: "deposits", label: "Setoran Tunai" },
  { key: "cashflow", label: "Arus Kas", ownerOnly: true },
  { key: "reconcile", label: "Rekonsiliasi" },
  { key: "hutang", label: "Hutang Dagang" },
];

interface FinanceSectionProps {
  viewerRole: Role;
}

export function FinanceSection({ viewerRole }: FinanceSectionProps) {
  const [tab, setTab] = useState<FinanceTab>("settlement");

  const visibleTabs = TABS.filter((t) => !t.ownerOnly || viewerRole === "owner");
  const canViewDeposits = hasPermission(viewerRole, "cash_deposit.view");

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-mahakan-green-900">
            <Banknote className="size-6" aria-hidden /> Keuangan
          </h1>
          <p className="text-sm text-neutral-700">
            Settlement harian, setoran tunai, arus kas, dan rekonsiliasi
            channel cashless.
          </p>
        </div>
        {canViewDeposits ? <CashOnHandTile /> : null}
      </header>

      <div
        role="tablist"
        aria-label="Finance tabs"
        className="flex gap-1 overflow-x-auto border-b border-neutral-200"
      >
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "shrink-0 border-b-2 px-4 py-2 text-sm font-medium transition-colors",
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
        {tab === "settlement" ? (
          <DailySettlementView />
        ) : tab === "bank" ? (
          <BankSettlementView viewerRole={viewerRole} />
        ) : tab === "deposits" ? (
          <SetoranTunaiView viewerRole={viewerRole} />
        ) : tab === "cashflow" ? (
          <ArusKasView />
        ) : tab === "reconcile" ? (
          <ReconciliationView viewerRole={viewerRole} />
        ) : (
          <HutangSurfacingView />
        )}
      </div>
    </div>
  );
}
