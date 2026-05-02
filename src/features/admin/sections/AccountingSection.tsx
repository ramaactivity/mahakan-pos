"use client";

import { useState } from "react";
import { BookOpen } from "lucide-react";
import { CoaView } from "./accounting/CoaView";
import { JournalView } from "./accounting/JournalView";
import { PeriodsView } from "./accounting/PeriodsView";
import { ReportsView } from "./accounting/ReportsView";
import type { Role } from "@/lib/auth/rbac";
import { cn } from "@/lib/utils";

type AccountingTab = "coa" | "journal" | "periods" | "reports";

const TABS: Array<{ key: AccountingTab; label: string }> = [
  { key: "coa", label: "Bagan Akun" },
  { key: "journal", label: "Jurnal" },
  { key: "periods", label: "Periode" },
  { key: "reports", label: "Laporan" },
];

interface AccountingSectionProps {
  viewerRole: Role;
}

export function AccountingSection({ viewerRole }: AccountingSectionProps) {
  const [tab, setTab] = useState<AccountingTab>("coa");

  return (
    <div className="space-y-4 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-mahakan-green-900">
          <BookOpen className="size-6" aria-hidden /> Akuntansi
        </h1>
        <p className="text-sm text-neutral-700">
          Bagan Akun, Jurnal Umum, dan Periode Akuntansi (cutover 1 Juni 2026).
          Auto-jurnal POS / payroll / setoran / aggregator akan aktif sesi
          berikutnya.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Akuntansi tabs"
        className="flex gap-1 overflow-x-auto border-b border-neutral-200"
      >
        {TABS.map((t) => (
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
        {tab === "coa" ? (
          <CoaView viewerRole={viewerRole} />
        ) : tab === "journal" ? (
          <JournalView viewerRole={viewerRole} />
        ) : tab === "periods" ? (
          <PeriodsView viewerRole={viewerRole} />
        ) : (
          <ReportsView />
        )}
      </div>
    </div>
  );
}
