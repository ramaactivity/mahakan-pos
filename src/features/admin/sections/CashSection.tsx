"use client";

import { useState } from "react";
import { CategoriesList } from "./cash/CategoriesList";
import { ExpensesList } from "./cash/ExpensesList";
import { IncomesList } from "./cash/IncomesList";
import { DailySummary } from "./cash/DailySummary";
import { cn } from "@/lib/utils";

type CashTab = "expenses" | "incomes" | "summary" | "categories";

const TABS: Array<{ key: CashTab; label: string }> = [
  { key: "expenses", label: "Pengeluaran" },
  { key: "incomes", label: "Pemasukan" },
  { key: "summary", label: "Ringkasan" },
  { key: "categories", label: "Kategori" },
];

interface CashSectionProps {
  viewerUserId: string;
}

export function CashSection({ viewerUserId }: CashSectionProps) {
  const [tab, setTab] = useState<CashTab>("summary");

  return (
    <div className="p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-mahakan-green-900">
          Kas &amp; Pengeluaran
        </h1>
        <p className="text-sm text-neutral-700">
          Pengeluaran harian, pemasukan non-POS, dan ringkasan kas.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Cash management tabs"
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
        {tab === "expenses" ? (
          <ExpensesList createdBy={viewerUserId} />
        ) : tab === "incomes" ? (
          <IncomesList createdBy={viewerUserId} />
        ) : tab === "summary" ? (
          <DailySummary />
        ) : (
          <CategoriesList />
        )}
      </div>
    </div>
  );
}
