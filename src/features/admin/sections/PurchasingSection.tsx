"use client";

import { useState } from "react";
import { Tab, TabList, TabPanel, Tabs } from "@/components/ui";
import { PurchaseRequestsSection } from "./PurchaseRequestsSection";
import { PurchasesView } from "./inventory/purchases/PurchasesView";
import { TopTrackerView } from "./inventory/purchases/TopTrackerView";

type PurchasingTab = "pr" | "po" | "gr" | "top";

/**
 * Sesi AE-173 — halaman Purchasing terpusat (gaya Little Sindbad), alur
 * PR → PO → GR + Hutang Dagang. Menggabungkan "Permintaan Belanja" + tab
 * "Pembelian" & "Hutang Dagang" yang sebelumnya ada di Inventory.
 */
export function PurchasingSection() {
  const [tab, setTab] = useState<PurchasingTab>("pr");

  return (
    <Tabs
      value={tab}
      onChange={(v) => setTab(v as PurchasingTab)}
      className="flex h-full flex-col"
    >
      <div className="space-y-4 px-6 pt-6">
        <header>
          <h1 className="text-2xl font-bold text-mahakan-green-900">
            Purchasing
          </h1>
          <p className="text-sm text-neutral-700">
            Alur belanja terpusat: Permintaan (PR) → Pesan (PO) → Terima Barang
            (GR). Plus pantau Hutang Dagang (TOP supplier).
          </p>
        </header>
        <TabList ariaLabel="Purchasing tabs">
          <Tab value="pr">PR</Tab>
          <Tab value="po">PO</Tab>
          <Tab value="gr">GR</Tab>
          <Tab value="top">Hutang Dagang</Tab>
        </TabList>
      </div>

      {/* PR sudah punya padding sendiri; PO/GR/TOP dibungkus p-6. */}
      <TabPanel value="pr">
        <PurchaseRequestsSection />
      </TabPanel>
      <TabPanel value="po">
        <div className="p-6">
          <PurchasesView variant="purchases" />
        </div>
      </TabPanel>
      <TabPanel value="gr">
        <div className="p-6">
          <PurchasesView variant="receipts" />
        </div>
      </TabPanel>
      <TabPanel value="top">
        <div className="p-6">
          <TopTrackerView />
        </div>
      </TabPanel>
    </Tabs>
  );
}
