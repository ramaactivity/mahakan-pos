"use client";

import { useEffect, useState } from "react";
import { ClipboardCheck, History, Table } from "lucide-react";
import type { Role } from "@/lib/auth";
import { Tab, TabList, TabPanel, Tabs } from "@/components/ui";
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
    <Tabs value={tab} onChange={(v) => setTab(v as ReconciliationTab)}>
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

        <TabList ariaLabel="Rekonsiliasi tabs">
          {TABS.map((t) => {
            const Icon = t.Icon;
            return (
              <Tab
                key={t.key}
                value={t.key}
                title={t.hint}
                className="flex items-center gap-1.5"
              >
                <Icon className="size-4" aria-hidden />
                {t.label}
              </Tab>
            );
          })}
        </TabList>
      </div>

      <TabPanel value="checklist">
        <OpeningBalanceWizard />
      </TabPanel>
      <TabPanel value="import">
        <HistoricalImportWizard />
      </TabPanel>
      <TabPanel value="list">
        <HistoricalSummaryList viewerRole={viewerRole} />
      </TabPanel>
    </Tabs>
  );
}
