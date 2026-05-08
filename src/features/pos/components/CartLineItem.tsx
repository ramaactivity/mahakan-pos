"use client";

import { MessageSquare, Trash2 } from "lucide-react";
import { QuantityStepper } from "@/components/ui";
import type { CartLineItem as CartLineItemType } from "@/features/pos/types";
import { formatRupiah } from "@/lib/format";

interface CartLineItemProps {
  item: CartLineItemType;
  onQuantityChange: (cartItemId: string, qty: number) => void;
  onRemove: (cartItemId: string) => void;
  onEditNote: (cartItemId: string) => void;
}

/**
 * Compact cart row — sesi AD-4 redesign per staff feedback.
 *
 * Old layout (py-3, two-row controls): ~72px per item, 4-5 items visible
 * at once on Galaxy A7 Lite (1340×800) with cart panel at 280-300px wide.
 * Cluttered modifier flex-wrap. Icon buttons p-1.5 below 44px tap target.
 *
 * New layout (py-2, integrated header): ~52px per item (-28%), 6-7 items
 * visible. Single-line name+variant header, modifier subtext only when
 * present, controls in slim row with bigger tap targets (sm stepper +
 * size:sm buttons → touch:h-11 via global rule).
 */
export function CartLineItem({
  item,
  onQuantityChange,
  onRemove,
  onEditNote,
}: CartLineItemProps) {
  const variantLabel =
    item.variant === "hot" ? "Hot" : item.variant === "iced" ? "Iced" : null;

  const activeModifiers = item.modifiers
    .filter((m) => m.selectedValue !== null && m.selectedValue !== "normal")
    .map((m) => m.selectedLabel ?? m.modifierSlug);

  const hasNote = Boolean(item.note);
  const hasOpenPriceNote = Boolean(item.openPriceNote);

  return (
    <div className="border-b border-neutral-200 px-3 py-2 last:border-0">
      {/* Top row: name (with variant inline) + price */}
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900">
          {item.name}
          {variantLabel ? (
            <span className="ml-1.5 text-xs font-normal text-neutral-600">
              · {variantLabel}
            </span>
          ) : null}
        </p>
        <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-neutral-900">
          {formatRupiah(item.subtotal)}
        </span>
      </div>

      {/* Subtext rows — only render when present (no empty space) */}
      {activeModifiers.length > 0 ? (
        <p className="truncate text-xs text-neutral-600">
          {activeModifiers.join(" · ")}
          {item.modifiersPriceDelta > 0 ? (
            <span className="ml-1 font-mono text-neutral-500">
              (+{formatRupiah(item.modifiersPriceDelta)}/pcs)
            </span>
          ) : null}
        </p>
      ) : null}
      {hasOpenPriceNote ? (
        <p className="truncate text-xs italic text-neutral-700">
          {item.openPriceNote}
        </p>
      ) : null}
      {hasNote ? (
        <p className="truncate text-xs italic text-neutral-600">
          &ldquo;{item.note}&rdquo;
        </p>
      ) : null}

      {/* Controls row — compact */}
      <div className="mt-1.5 flex items-center justify-between">
        <QuantityStepper
          value={item.quantity}
          onChange={(qty) => onQuantityChange(item.cartItemId, qty)}
          min={0}
          max={99}
          aria-label={`Jumlah ${item.name}`}
        />
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onEditNote(item.cartItemId)}
            aria-label={hasNote ? "Edit catatan" : "Tambah catatan"}
            className="flex size-9 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
          >
            <MessageSquare className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => onRemove(item.cartItemId)}
            aria-label={`Hapus ${item.name}`}
            className="flex size-9 items-center justify-center rounded-md text-danger-500 transition-colors hover:bg-danger-100"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
