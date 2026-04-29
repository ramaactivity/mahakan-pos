"use client";

import { ChevronRight, Heart, Star } from "lucide-react";
import { Badge } from "@/components/ui";
import type { MenuItem } from "@/features/menu";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MenuListRowProps {
  item: MenuItem;
  onSelect: (item: MenuItem) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (id: string) => void;
}

/**
 * Horizontal list-row alternative to MenuTile. Used when MenuLayoutMode is
 * "list" — full-width name + description, price right-aligned, badges inline.
 * Suits long menu names + detailed descriptions where the tile grid feels
 * cramped.
 */
export function MenuListRow({ item, onSelect, isFavorite, onToggleFavorite }: MenuListRowProps) {
  const disabled = item.isSoldOut;

  const priceLabel =
    item.priceType === "fixed"
      ? formatRupiah(item.priceFixed ?? 0)
      : item.priceType === "open"
        ? "Manual"
        : item.priceHot && item.priceIced && item.priceHot !== item.priceIced
          ? `${formatRupiah(item.priceHot)} / ${formatRupiah(item.priceIced)}`
          : item.priceHot
            ? formatRupiah(item.priceHot)
            : item.priceIced
              ? formatRupiah(item.priceIced)
              : "—";

  return (
    <div
      className={cn(
        "group relative flex items-center gap-1 rounded-lg border bg-white pr-2 transition-all",
        disabled
          ? "border-neutral-200 opacity-50 grayscale"
          : "border-neutral-200 hover:border-mahakan-green-700 hover:shadow-sm",
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect(item)}
        className={cn(
          "flex flex-1 items-center gap-3 p-3 text-left",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-2 rounded-lg",
          disabled
            ? "cursor-not-allowed"
            : "active:scale-[0.99]",
        )}
      >
        <div className="flex flex-1 min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            {item.isSignature ? (
              <Heart
                className="size-3.5 fill-mahakan-green-700 text-mahakan-green-700"
                aria-label="Signature"
              />
            ) : null}
            <span className="truncate text-base font-semibold text-neutral-900">
              {item.name}
            </span>
          </div>
          {item.description ? (
            <p className="line-clamp-1 text-xs text-neutral-500">
              {item.description}
            </p>
          ) : null}
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {item.priceType === "open" ? (
              <Badge variant="open-price">Harga Manual</Badge>
            ) : null}
            {item.priceType === "variant" ? (
              <Badge variant="info">Hot/Iced</Badge>
            ) : null}
            {item.isSoldOut ? <Badge variant="sold-out">Habis</Badge> : null}
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          <span className="font-mono text-sm font-semibold text-neutral-900">
            {priceLabel}
          </span>
          <ChevronRight
            className="size-4 text-neutral-400 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </div>
      </button>
      {onToggleFavorite ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(item.id);
          }}
          aria-label={isFavorite ? `Unpin ${item.name}` : `Pin ${item.name}`}
          aria-pressed={isFavorite}
          className={cn(
            "rounded-full p-1.5 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
            isFavorite
              ? "text-amber-500 hover:bg-amber-50"
              : "text-neutral-300 hover:bg-neutral-100 hover:text-amber-500",
          )}
        >
          <Star
            className={cn("size-4", isFavorite && "fill-amber-500")}
            aria-hidden
          />
        </button>
      ) : null}
    </div>
  );
}
