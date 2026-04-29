"use client";

import { Star, X } from "lucide-react";
import type { MenuItem } from "@/features/menu";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

interface FavoritesBarProps {
  /** Ordered list of favorited item IDs. */
  favoriteIds: string[];
  /** Full menu items map; used to resolve IDs to current item state. */
  itemsById: Record<string, MenuItem>;
  onSelect: (item: MenuItem) => void;
  onUnpin: (id: string) => void;
}

/**
 * Quick-access strip for pinned menu items. Resolved from useFavorites() hook
 * + items map. Items pinned but no longer in the active menu (deleted /
 * deactivated) are quietly dropped from the bar (still in storage in case
 * they come back). Tap = dispatch immediately; X = unpin.
 */
export function FavoritesBar({
  favoriteIds,
  itemsById,
  onSelect,
  onUnpin,
}: FavoritesBarProps) {
  const resolved = favoriteIds
    .map((id) => itemsById[id])
    .filter((it): it is MenuItem => !!it);

  if (resolved.length === 0) return null;

  return (
    <div
      className="flex items-center gap-2 overflow-x-auto border-b border-neutral-200 bg-amber-50/40 px-4 py-2"
      role="region"
      aria-label="Quick favorites"
    >
      <div className="flex shrink-0 items-center gap-1 text-xs font-medium uppercase tracking-wide text-amber-700">
        <Star className="size-3.5 fill-amber-500 text-amber-500" aria-hidden />
        Favorit
      </div>
      <div className="flex flex-1 gap-2">
        {resolved.map((item) => {
          const disabled = item.isSoldOut;
          const priceShort =
            item.priceType === "fixed"
              ? formatRupiah(item.priceFixed ?? 0)
              : item.priceType === "open"
                ? "Manual"
                : item.priceHot
                  ? formatRupiah(item.priceHot)
                  : item.priceIced
                    ? formatRupiah(item.priceIced)
                    : "—";
          return (
            <div
              key={item.id}
              className={cn(
                "group relative flex shrink-0 items-center rounded-md border bg-white shadow-sm",
                disabled
                  ? "border-neutral-200 opacity-50 grayscale"
                  : "border-amber-200 hover:border-amber-400",
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(item)}
                disabled={disabled}
                className="flex flex-col items-start gap-0.5 px-3 py-1.5 text-left text-xs disabled:cursor-not-allowed"
              >
                <span className="line-clamp-1 max-w-[8rem] font-semibold text-neutral-900">
                  {item.name}
                </span>
                <span className="font-mono text-[11px] text-neutral-600">
                  {priceShort}
                </span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onUnpin(item.id);
                }}
                aria-label={`Unpin ${item.name}`}
                className="ml-1 mr-1 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              >
                <X className="size-3" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
