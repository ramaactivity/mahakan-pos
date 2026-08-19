"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, CheckCircle2, Zap } from "lucide-react";
import { Tab, TabList, TabPanel, Tabs } from "@/components/ui";
import { ClosingView } from "./accounting/ClosingView";
import { CoaView } from "./accounting/CoaView";
import { FixedAssetsView } from "./accounting/FixedAssetsView";
import { JournalView } from "./accounting/JournalView";
import { PeriodsView } from "./accounting/PeriodsView";
import { ReportsView } from "./accounting/ReportsView";
import { OpeningBalanceEditor } from "./reconciliation/OpeningBalanceEditor";
import { getOwnOutlet, isOk as outletIsOk } from "@/features/outlets";
import type { Role } from "@/lib/auth/rbac";
import { cn } from "@/lib/utils";

type AccountingTab =
  | "coa"
  | "journal"
  | "closing"
  | "periods"
  | "opening"
  | "reports"
  | "assets";

const TABS: Array<{ key: AccountingTab; label: string }> = [
  { key: "coa", label: "Bagan Akun" },
  { key: "journal", label: "Jurnal" },
  /* Sesi AE-211 — tab sendiri untuk tutup buku bulanan. Tombolnya dulu
   * terselip di tab Periode tanpa pratinjau sama sekali: owner menekan, jurnal
   * penutup terbentuk, dan baru sesudahnya bisa dilihat isinya. */
  { key: "closing", label: "Tutup Buku" },
  { key: "periods", label: "Periode" },
  /* Sesi AE-207 — tab sendiri supaya mudah ditemukan. Owner butuh ini setelah
   * cutoff: saldo awal diambil dari GL, lalu disesuaikan ke data fisik. */
  { key: "opening", label: "Saldo Awal" },
  { key: "reports", label: "Laporan" },
  { key: "assets", label: "Aset Tetap" },
];

interface AccountingSectionProps {
  viewerRole: Role;
}

export function AccountingSection({ viewerRole }: AccountingSectionProps) {
  const [tab, setTab] = useState<AccountingTab>("coa");

  // Sesi AE-62c — flag indicator di header. Owner langsung tau active/not.
  const outletQuery = useQuery({
    queryKey: ["admin", "outlet", "own"],
    queryFn: async () => {
      const res = await getOwnOutlet();
      if (!outletIsOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });
  const autoJournalEnabled =
    outletQuery.data?.settings?.features?.accounting_auto_journal === true;

  return (
    <Tabs
      value={tab}
      onChange={(v) => setTab(v as AccountingTab)}
      className="space-y-4 p-6"
    >
      <header>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-mahakan-green-900">
            <BookOpen className="size-6" aria-hidden /> Akuntansi
          </h1>
          {!outletQuery.isLoading ? (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
                autoJournalEnabled
                  ? "bg-success-100 text-success-700"
                  : "bg-warning-100 text-warning-700",
              )}
              title={
                autoJournalEnabled
                  ? "Transaksi POS / payroll / setoran auto-post ke jurnal"
                  : "Transaksi tidak auto-post — toggle di Settings → Auto-Journal Akuntansi"
              }
            >
              {autoJournalEnabled ? (
                <>
                  <CheckCircle2 className="size-3.5" aria-hidden /> Auto-Journal:
                  AKTIF
                </>
              ) : (
                <>
                  <Zap className="size-3.5" aria-hidden /> Auto-Journal:
                  NONAKTIF
                </>
              )}
            </span>
          ) : null}
        </div>
        <p className="text-sm text-neutral-700">
          Bagan Akun, Jurnal Umum, Tutup Buku bulanan, dan Periode Akuntansi.{" "}
          {autoJournalEnabled ? (
            <span className="text-success-700">
              Auto-jurnal AKTIF — POS / payroll / setoran / pembelian /
              opname / aggregator otomatis ter-post ke jurnal.
            </span>
          ) : (
            <span className="text-warning-700">
              Auto-jurnal NONAKTIF — aktifkan di tab Jurnal atau Settings →
              Auto-Journal Akuntansi supaya transaksi auto-post.
            </span>
          )}
        </p>
      </header>

      <TabList ariaLabel="Akuntansi tabs" className="overflow-x-auto">
        {TABS.map((t) => (
          <Tab key={t.key} value={t.key} className="shrink-0">
            {t.label}
          </Tab>
        ))}
      </TabList>

      <TabPanel value="coa">
        <CoaView viewerRole={viewerRole} />
      </TabPanel>
      <TabPanel value="journal">
        <JournalView viewerRole={viewerRole} />
      </TabPanel>
      <TabPanel value="closing">
        <ClosingView viewerRole={viewerRole} />
      </TabPanel>
      <TabPanel value="periods">
        <PeriodsView viewerRole={viewerRole} />
      </TabPanel>
      <TabPanel value="opening">
        {viewerRole === "owner" ? (
          <OpeningBalanceEditor />
        ) : (
          <p className="p-6 text-sm text-neutral-600">
            Hanya Owner yang dapat melihat &amp; mengubah saldo awal.
          </p>
        )}
      </TabPanel>
      <TabPanel value="reports">
        <ReportsView />
      </TabPanel>
      <TabPanel value="assets">
        <FixedAssetsView viewerRole={viewerRole} />
      </TabPanel>
    </Tabs>
  );
}
