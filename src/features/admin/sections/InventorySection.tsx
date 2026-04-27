"use client";

import { useState } from "react";
import { IngredientsList } from "./inventory/IngredientsList";
import { cn } from "@/lib/utils";

type InventoryTab = "ingredients" | "movements" | "recipes";

const TABS: Array<{ key: InventoryTab; label: string; soon?: boolean }> = [
  { key: "ingredients", label: "Bahan" },
  { key: "movements", label: "Pergerakan", soon: true },
  { key: "recipes", label: "Resep", soon: true },
];

export function InventorySection() {
  const [tab, setTab] = useState<InventoryTab>("ingredients");

  return (
    <div className="space-y-4 p-6">
      <header>
        <h1 className="text-2xl font-bold text-mahakan-green-900">Inventory</h1>
        <p className="text-sm text-neutral-700">
          Kelola bahan, terima stok, dan catat pergerakan inventory.
        </p>
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
        ) : (
          <p className="py-8 text-center text-sm text-neutral-500">
            Tab ini akan tersedia di sub-chunk berikutnya (M22.4b/c).
          </p>
        )}
      </div>
    </div>
  );
}
