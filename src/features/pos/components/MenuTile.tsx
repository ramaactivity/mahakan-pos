"use client";

import { Heart } from "lucide-react";
import { Badge } from "@/components/ui";
import type { MenuItem } from "@/features/menu";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MenuTileProps {
  item: MenuItem;
  onSelect: (item: MenuItem) => void;
}

export function MenuTile({ item, onSelect }: MenuTileProps) {
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
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(item)}
      className={cn(
        "flex h-full flex-col rounded-xl border bg-white p-3 text-left transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-2",
        disabled
          ? "cursor-not-allowed border-neutral-200 opacity-50 grayscale"
          : "border-neutral-200 hover:border-mahakan-green-700 hover:shadow-md active:scale-[0.98]",
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        {item.isSignature ? (
          <Badge variant="signature">
            <Heart className="size-3" aria-hidden /> Signature
          </Badge>
        ) : (
          <span />
        )}
        {item.priceType === "open" ? (
          <Badge variant="open-price">Harga Manual</Badge>
        ) : null}
        {item.isSoldOut ? <Badge variant="sold-out">Habis</Badge> : null}
      </div>
      <span className="line-clamp-2 text-base font-semibold text-neutral-900 leading-tight">
        {item.name}
      </span>
      <span className="mt-auto pt-2 font-mono text-sm font-medium text-neutral-700">
        {priceLabel}
      </span>
    </button>
  );
}
