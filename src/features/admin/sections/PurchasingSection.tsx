"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, Tab, TabList, TabPanel, Tabs } from "@/components/ui";
import { PurchaseRequestsSection } from "./PurchaseRequestsSection";
import { PurchasesView } from "./inventory/purchases/PurchasesView";
import { TopTrackerView } from "./inventory/purchases/TopTrackerView";
import { GoodsReceiptModal } from "./inventory/purchases/GoodsReceiptModal";
import { GoodsReceiptsList } from "./inventory/purchases/GoodsReceiptsList";

type PurchasingTab = "pr" | "po" | "gr" | "top";

/**
 * Sesi AE-173 — halaman Purchasing terpusat (gaya Little Sindbad), alur
 * PR → PO → GR + Hutang Dagang. Menggabungkan "Permintaan Belanja" + tab
 * "Pembelian" & "Hutang Dagang" yang sebelumnya ada di Inventory.
 */
export function PurchasingSection() {
  const [tab, setTab] = useState<PurchasingTab>("pr");
  const [grOpen, setGrOpen] = useState(false);
  const [grRefresh, setGrRefresh] = useState(0);
  /* Sesi AE-177 — PO yang dipre-fill saat buka modal GR dari tombol "Terima"
   * di tab PO → alur PO→GR tersambung (satu modal terima konsisten). */
  const [grPrefillPoId, setGrPrefillPoId] = useState<string | null>(null);

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
          <PurchasesView
            variant="purchases"
            onReceivePo={(poId) => {
              setGrPrefillPoId(poId);
              setGrOpen(true);
            }}
          />
        </div>
      </TabPanel>
      <TabPanel value="gr">
        <div className="space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-mahakan-green-200 bg-mahakan-green-50/50 p-4">
            <div>
              <h3 className="text-sm font-semibold text-mahakan-green-900">
                Terima Barang dari PO
              </h3>
              <p className="text-xs text-neutral-600">
                Tarik data dari PO, isi qty diterima per bahan (bisa sebagian).
              </p>
            </div>
            <Button onClick={() => setGrOpen(true)}>
              <Plus className="size-4" aria-hidden /> Buat GR
            </Button>
          </div>
          <GoodsReceiptsList refreshKey={grRefresh} />
        </div>
      </TabPanel>
      <TabPanel value="top">
        <div className="p-6">
          <TopTrackerView />
        </div>
      </TabPanel>

      <GoodsReceiptModal
        open={grOpen}
        prefillPoId={grPrefillPoId}
        onClose={() => {
          setGrOpen(false);
          setGrPrefillPoId(null);
        }}
        onSaved={() => {
          setGrOpen(false);
          setGrPrefillPoId(null);
          setGrRefresh((k) => k + 1);
        }}
      />
    </Tabs>
  );
}
