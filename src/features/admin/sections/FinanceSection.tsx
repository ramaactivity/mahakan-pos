"use client";

import { useState } from "react";
import { Banknote } from "lucide-react";
import { Tab, TabList, TabPanel, Tabs } from "@/components/ui";
import { BankSettlementView } from "./finance/BankSettlementView";
import { CashOnHandTile } from "./finance/CashOnHandTile";
import { DailySettlementView } from "./finance/DailySettlementView";
import { ArusKasView } from "./finance/ArusKasView";
import { ReconciliationView } from "./finance/ReconciliationView";
import { HutangSurfacingView } from "./finance/HutangSurfacingView";
import { hasPermission } from "@/lib/auth/rbac";
import type { Role } from "@/lib/auth/rbac";

type FinanceTab =
  | "settlement"
  | "bank"
  | "cashflow"
  | "reconcile"
  | "hutang";

// Sesi AE-8 — "Setoran Tunai" tab sudah promote ke top-level sidebar
// (Cashflow group). Sub-tab disini dihapus supaya tidak duplikasi.
const TABS: Array<{
  key: FinanceTab;
  label: string;
  ownerOnly?: boolean;
}> = [
  { key: "settlement", label: "Ringkasan Shift" },
  { key: "bank", label: "Mutasi Bank" },
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
    <Tabs
      value={tab}
      onChange={(v) => setTab(v as FinanceTab)}
      className="space-y-4 p-6"
    >
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

      <TabList ariaLabel="Finance tabs" className="overflow-x-auto">
        {visibleTabs.map((t) => (
          <Tab key={t.key} value={t.key} className="shrink-0">
            {t.label}
          </Tab>
        ))}
      </TabList>

      <TabPanel value="settlement">
        <DailySettlementView />
      </TabPanel>
      <TabPanel value="bank">
        <BankSettlementView viewerRole={viewerRole} />
      </TabPanel>
      <TabPanel value="cashflow">
        <ArusKasView />
      </TabPanel>
      <TabPanel value="reconcile">
        <ReconciliationView viewerRole={viewerRole} />
      </TabPanel>
      <TabPanel value="hutang">
        <HutangSurfacingView />
      </TabPanel>
    </Tabs>
  );
}
