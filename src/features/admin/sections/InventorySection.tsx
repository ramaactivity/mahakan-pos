"use client";

import { useState } from "react";
import { Calculator } from "lucide-react";
import { Button } from "@/components/ui";
import { CogsCalculatorWidget } from "./inventory/CogsCalculatorWidget";
import { IngredientsList } from "./inventory/IngredientsList";
import { MovementsList } from "./inventory/MovementsList";
import { OpnameTab } from "./inventory/opname/OpnameTab";
import { PreparationsList } from "./inventory/PreparationsList";
import { PurchasesView } from "./inventory/purchases/PurchasesView";
import { RecipesList } from "./inventory/RecipesList";
import { TopTrackerView } from "./inventory/purchases/TopTrackerView";
import { cn } from "@/lib/utils";

type InventoryTab =
  | "ingredients"
  | "preparations"
  | "opname"
  | "purchases"
  | "top"
  | "movements"
  | "recipes";

const TABS: Array<{ key: InventoryTab; label: string; soon?: boolean }> = [
  { key: "ingredients", label: "Bahan" },
  { key: "preparations", label: "Preparations" },
  { key: "purchases", label: "Pembelian" },
  { key: "top", label: "Hutang Dagang" },
  { key: "opname", label: "Opname" },
  { key: "movements", label: "Pergerakan" },
  { key: "recipes", label: "Resep" },
];

export function InventorySection() {
  const [tab, setTab] = useState<InventoryTab>("ingredients");
  const [calcOpen, setCalcOpen] = useState(false);

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-mahakan-green-900">
            Inventory
          </h1>
          <p className="text-sm text-neutral-700">
            Kelola bahan, preparation, terima stok, dan pantau pergerakan
            inventory.
          </p>
        </div>
        <Button variant="outline" onClick={() => setCalcOpen(true)}>
          <Calculator className="size-4" aria-hidden /> COGS Calculator
        </Button>
      </header>

      <div
        role="tablist"
        aria-label="Inventory tabs"
        className="flex gap-1 border-b border-neutral-200"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => !t.soon && setTab(t.key)}
            disabled={t.soon}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
              tab === t.key
                ? "border-mahakan-green-700 text-mahakan-green-900"
                : "border-transparent text-neutral-500 hover:text-neutral-900",
              t.soon && "cursor-not-allowed opacity-60",
            )}
          >
            {t.label}
            {t.soon ? (
              <span className="ml-1.5 text-[10px] uppercase text-neutral-400">
                Segera
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div>
        {tab === "ingredients" ? (
          <IngredientsList />
        ) : tab === "preparations" ? (
          <PreparationsList />
        ) : tab === "purchases" ? (
          <PurchasesView />
        ) : tab === "top" ? (
          <TopTrackerView />
        ) : tab === "opname" ? (
          <OpnameTab />
        ) : tab === "movements" ? (
          <MovementsList />
        ) : (
          <RecipesList />
        )}
      </div>

      <CogsCalculatorWidget
        open={calcOpen}
        onClose={() => setCalcOpen(false)}
      />
    </div>
  );
}
