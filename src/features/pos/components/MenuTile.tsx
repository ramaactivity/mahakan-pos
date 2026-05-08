"use client";

import { Heart, Star } from "lucide-react";
import { Badge } from "@/components/ui";
import type { MenuItem } from "@/features/menu";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MenuTileProps {
  item: MenuItem;
  onSelect: (item: MenuItem) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (id: string) => void;
}

/**
 * Format price for menu tile.
 *
 * - fixed: "Rp 19.000"
 * - open: "Manual"
 * - hot+iced same: "Rp 19.000"
 * - hot+iced different: returns object so caller can render two-line
 *   with Hot/Iced labels (clearer than "Rp 17.000 / Rp 16.000" — staff
 *   complained the slash is ambiguous).
 */
function formatPrice(item: MenuItem):
  | { kind: "single"; label: string }
  | { kind: "dual"; hot: string; iced: string }
  | { kind: "manual" } {
  if (item.priceType === "fixed") {
    return { kind: "single", label: formatRupiah(item.priceFixed ?? 0) };
  }
  if (item.priceType === "open") return { kind: "manual" };

  const hot = item.priceHot;
  const iced = item.priceIced;
  if (hot && iced && hot !== iced) {
    return {
      kind: "dual",
      hot: formatRupiah(hot),
      iced: formatRupiah(iced),
    };
  }
  if (hot) return { kind: "single", label: formatRupiah(hot) };
  if (iced) return { kind: "single", label: formatRupiah(iced) };
  return { kind: "single", label: "—" };
}

/**
 * Menu grid card — sesi AD-4 redesign per staff feedback ("font terlalu
 * besar, kurang intuitif").
 *
 * Changes from previous design:
 * - Name: text-base font-semibold → text-sm font-semibold (less shouty,
 *   more menu items fit per row at same card height)
 * - Padding: p-3 → p-2.5
 * - Dual-price (Hot/Iced): split into two labeled rows instead of
 *   ambiguous slash; staff couldn't tell which price is which
 * - Bottom price area now has subtle divider for visual hierarchy
 * - Favorite star: bigger tap target via inset wrapper
 * - Sold-out: shows "HABIS" overlay instead of just opacity (clearer)
 */
export function MenuTile({ item, onSelect, isFavorite, onToggleFavorite }: MenuTileProps) {
  const disabled = item.isSoldOut;
  const price = formatPrice(item);
  const hasBadge = item.isSignature || item.priceType === "open";

  return (
    <div className="relative h-full">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect(item)}
        className={cn(
          "group flex h-full w-full flex-col rounded-xl border bg-white p-2.5 text-left transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-2",
          disabled
            ? "cursor-not-allowed border-neutral-200 opacity-60"
            : "border-neutral-200 hover:border-mahakan-green-700 active:scale-[0.98]",
        )}
      >
        {/* Top row: signature/open-price badge (if any) — leave space for star button */}
        {hasBadge ? (
          <div className="mb-1 flex items-start gap-1 pr-7">
            {item.isSignature ? (
              <Badge variant="signature" className="text-[10px]">
                <Heart className="size-2.5" aria-hidden /> Signature
              </Badge>
            ) : null}
            {item.priceType === "open" ? (
              <Badge variant="open-price" className="text-[10px]">
                Harga Manual
              </Badge>
            ) : null}
          </div>
        ) : (
          /* Reserve space so layout doesn't jump between badged/unbadged tiles */
          <div className="h-2 pr-7" />
        )}

        {/* Item name — line-clamp-2, dense */}
        <span className="line-clamp-2 text-sm font-semibold leading-snug text-neutral-900">
          {item.name}
        </span>

        {/* Price — at bottom via mt-auto, with subtle separator */}
        <div className="mt-auto pt-2">
          {price.kind === "manual" ? (
            <span className="font-mono text-xs italic text-neutral-600">
              Manual
            </span>
          ) : price.kind === "dual" ? (
            <div className="space-y-0.5">
              <div className="flex items-baseline justify-between gap-1 font-mono text-xs">
                <span className="text-neutral-500">Hot</span>
                <span className="font-semibold text-neutral-900 tabular-nums">
                  {price.hot}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-1 font-mono text-xs">
                <span className="text-neutral-500">Iced</span>
                <span className="font-semibold text-neutral-900 tabular-nums">
                  {price.iced}
                </span>
              </div>
            </div>
          ) : (
            <span className="font-mono text-sm font-semibold tabular-nums text-neutral-900">
              {price.label}
            </span>
          )}
        </div>

        {/* Sold-out overlay — clearer than just opacity grayscale */}
        {disabled ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-white/60">
            <span className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-neutral-700 shadow-sm">
              Habis
            </span>
          </div>
        ) : null}
      </button>

      {/* Favorite star — top-right, bigger tap zone via larger button */}
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
            "absolute right-1 top-1 flex size-8 items-center justify-center rounded-full transition-colors",
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
