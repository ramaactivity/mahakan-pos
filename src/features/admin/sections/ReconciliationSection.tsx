"use client";

import { useEffect, useState } from "react";
import { ClipboardCheck, History, Table } from "lucide-react";
import type { Role } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { HistoricalImportWizard } from "./reconciliation/HistoricalImportWizard";
import { HistoricalSummaryList } from "./reconciliation/HistoricalSummaryList";
import { OpeningBalanceWizard } from "./reconciliation/OpeningBalanceWizard";

type ReconciliationTab = "checklist" | "import" | "list";

const TABS: Array<{
  key: ReconciliationTab;
  label: string;
  Icon: typeof ClipboardCheck;
  hint: string;
}> = [
  {
    key: "checklist",
    label: "Saldo Awal",
    Icon: ClipboardCheck,
    hint: "Wizard setup awal trial",
  },
  {
    key: "import",
    label: "Import Histori",
    Icon: History,
    hint: "Upload CSV Majoo/Kasir Pintar",
  },
  {
    key: "list",
    label: "Daftar Historis",
    Icon: Table,
    hint: "Lihat & edit data ter-import",
  },
];

interface ReconciliationSectionProps {
  viewerRole: Role;
}

export function ReconciliationSection({
  viewerRole,
}: ReconciliationSectionProps) {
  const [tab, setTab] = useState<ReconciliationTab>("checklist");

  /* Sesi AE-75 — Listen ke event dari OpeningBalanceWizard "Selesai" screen,
   * supaya CTA "Lanjut ke Import Histori" bisa switch tab di parent. */
  useEffect(() => {
    function onSwitch(e: Event) {
      const ce = e as CustomEvent<{ tab: ReconciliationTab }>;
      if (ce.detail?.tab) setTab(ce.detail.tab);
    }
    window.addEventListener("reconciliation:switch-tab", onSwitch);
    return () =>
      window.removeEventListener("reconciliation:switch-tab", onSwitch);
  }, []);

  return (
    <div>
      <div className="space-y-3 px-6 pt-6">
        <header>
          <h1 className="text-2xl font-bold text-mahakan-green-900">
            Rekonsiliasi Data Lama
          </h1>
          <p className="max-w-3xl text-sm text-neutral-700">
            Migrasi data dari POS sebelumnya (Majoo / Kasir Pintar) supaya
            laporan akuntansi & investor lengkap. Mulai dari setup saldo awal,
            lalu import histori CSV per bulan.
          </p>
        </header>

        <div
          role="tablist"
          aria-label="Rekonsiliasi tabs"
          className="flex gap-1 border-b border-neutral-200"
        >
          {TABS.map((t) => {
            const active = tab === t.key;
            const Icon = t.Icon;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                  active
                    ? "border-mahakan-green-700 text-mahakan-green-900"
                    : "border-transparent text-neutral-500 hover:text-neutral-900",
                )}
                title={t.hint}
              >
                <Icon className="size-4" aria-hidden />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "checklist" ? (
        <OpeningBalanceWizard />
      ) : tab === "import" ? (
        <HistoricalImportWizard />
      ) : (
        <HistoricalSummaryList viewerRole={viewerRole} />
      )}
    </div>
  );
}
