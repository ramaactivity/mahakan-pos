"use client";

import { useState } from "react";
import { ItemsList } from "./menu/ItemsList";
import { CategoriesList } from "./menu/CategoriesList";
import { ModifiersConfig } from "./menu/ModifiersConfig";
import { cn } from "@/lib/utils";

type MenuTab = "items" | "categories" | "modifiers";

const TABS: Array<{ key: MenuTab; label: string }> = [
  { key: "items", label: "Items" },
  { key: "categories", label: "Kategori" },
  { key: "modifiers", label: "Modifier" },
];

export function MenuSection() {
  const [tab, setTab] = useState<MenuTab>("items");

  return (
    <div className="p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-mahakan-green-900">
          Menu Management
        </h1>
        <p className="text-sm text-neutral-700">
          CRUD menu items, kategori, dan konfigurasi modifier.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Menu management tabs"
        className="flex gap-1 border-b border-neutral-200"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
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
        {tab === "items" ? (
          <ItemsList />
        ) : tab === "categories" ? (
          <CategoriesList />
        ) : (
          <ModifiersConfig />
        )}
      </div>
    </div>
  );
}
