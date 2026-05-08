"use client";

import type { Category } from "@/features/menu";
import { cn } from "@/lib/utils";

interface CategoryTabsProps {
  categories: Category[];
  activeId: string | "all";
  onChange: (id: string | "all") => void;
  /** Optional count badges per category */
  itemCounts?: Record<string, number>;
}

export function CategoryTabs({
  categories,
  activeId,
  onChange,
  itemCounts,
}: CategoryTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Kategori menu"
      className="flex gap-2 overflow-x-auto pb-1"
    >
      <CategoryButton
        label="Semua"
        active={activeId === "all"}
        onClick={() => onChange("all")}
      />
      {categories.map((cat) => (
        <CategoryButton
          key={cat.id}
          label={cat.name}
          count={itemCounts?.[cat.id]}
          active={activeId === cat.id}
          onClick={() => onChange(cat.id)}
        />
      ))}
    </div>
  );
}

function CategoryButton({
  label,
  active,
  count,
  onClick,
}: {
  label: string;
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-2",
        active
          ? "border-mahakan-green-700 bg-mahakan-green-700 text-white"
          : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:text-neutral-900",
      )}
    >
      {label}
      {count !== undefined ? (
        <span
          className={cn(
            "rounded-full px-1.5 py-0 text-xs font-mono",
            active
              ? "bg-mahakan-green-800/50 text-white"
              : "bg-neutral-100 text-neutral-500",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
