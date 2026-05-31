"use client";

import { useState } from "react";
import { Calculator } from "lucide-react";
import { Button, Tab, TabList, TabPanel, Tabs } from "@/components/ui";
import { CogsCalculatorWidget } from "./inventory/CogsCalculatorWidget";
import { IngredientsList } from "./inventory/IngredientsList";
import { MarketListView } from "./inventory/market-list/MarketListView";
import { MovementsList } from "./inventory/MovementsList";
import type { AdminSection } from "../components/AdminLeftNav";

// Sesi AE-173 — tab "Pembelian"/"Hutang Dagang" → Purchasing; "Opname" →
// Persediaan Bahan Baku (halaman COGS).
type InventoryTab = "ingredients" | "market_list" | "movements";

const TABS: Array<{ key: InventoryTab; label: string; soon?: boolean }> = [
  { key: "ingredients", label: "Bahan" },
  { key: "market_list", label: "Market List" },
  { key: "movements", label: "Pergerakan" },
];

interface InventorySectionProps {
  onNavigate?: (section: AdminSection) => void;
}

export function InventorySection({ onNavigate }: InventorySectionProps = {}) {
  const [tab, setTab] = useState<InventoryTab>("ingredients");
  const [calcOpen, setCalcOpen] = useState(false);

  return (
    <Tabs
      value={tab}
      onChange={(v) => setTab(v as InventoryTab)}
      className="space-y-4 p-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-mahakan-green-900">
            Inventory
          </h1>
          <p className="text-sm text-neutral-700">
            Kelola bahan baku & pantau pergerakan inventory. Stock Opname →
            Persediaan Bahan Baku. Pembelian/PO/GR & Hutang Dagang → Purchasing.
          </p>
        </div>
        <Button variant="outline" onClick={() => setCalcOpen(true)}>
          <Calculator className="size-4" aria-hidden /> COGS Calculator
        </Button>
      </header>

      <TabList ariaLabel="Inventory tabs">
        {TABS.map((t) => (
          <Tab key={t.key} value={t.key} disabled={t.soon}>
            {t.label}
            {t.soon ? (
              <span className="ml-1.5 text-[10px] uppercase text-neutral-400">
                Segera
              </span>
            ) : null}
          </Tab>
        ))}
      </TabList>

      <TabPanel value="ingredients">
        <IngredientsList />
      </TabPanel>
      <TabPanel value="market_list">
        <MarketListView />
      </TabPanel>
      <TabPanel value="movements">
        <MovementsList />
      </TabPanel>

      <CogsCalculatorWidget
        open={calcOpen}
        onClose={() => setCalcOpen(false)}
        onSaveAsMenu={
          onNavigate
            ? () => {
                setCalcOpen(false);
                onNavigate("menu");
              }
            : undefined
        }
      />
    </Tabs>
  );
}
