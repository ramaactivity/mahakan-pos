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

export function CartLineItem({
  item,
  onQuantityChange,
  onRemove,
  onEditNote,
}: CartLineItemProps) {
  const variantLabel =
    item.variant === "hot" ? "Hot" : item.variant === "iced" ? "Iced" : null;

  const modifierSummary = item.modifiers
    .filter((m) => m.selectedValue !== null && m.selectedValue !== "normal")
    .map((m) => m.selectedLabel ?? m.modifierSlug)
    .join(", ");

  return (
    <div className="flex gap-3 border-b border-neutral-200 px-3 py-3 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-neutral-900">{item.name}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-neutral-500">
          {variantLabel ? <span>{variantLabel}</span> : null}
          {modifierSummary ? <span>· {modifierSummary}</span> : null}
        </div>
        {item.openPriceNote ? (
          <p className="mt-0.5 text-xs italic text-neutral-700">
            {item.openPriceNote}
          </p>
        ) : null}
        {item.note ? (
          <p className="mt-0.5 text-xs italic text-neutral-600">
            &ldquo;{item.note}&rdquo;
          </p>
        ) : null}
        <div className="mt-2 flex items-center gap-2">
          <QuantityStepper
            value={item.quantity}
            onChange={(qty) => onQuantityChange(item.cartItemId, qty)}
            min={0}
            max={99}
            aria-label={`Jumlah ${item.name}`}
          />
          <button
            type="button"
            onClick={() => onEditNote(item.cartItemId)}
            aria-label="Edit catatan"
            className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
          >
            <MessageSquare className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => onRemove(item.cartItemId)}
            aria-label={`Hapus ${item.name}`}
            className="rounded-md p-1.5 text-danger-500 hover:bg-danger-100"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      </div>
      <div className="flex flex-col items-end justify-start">
        <span className="font-mono text-sm font-semibold text-neutral-900">
          {formatRupiah(item.subtotal)}
        </span>
        {item.modifiersPriceDelta > 0 ? (
          <span className="font-mono text-[10px] text-neutral-500">
            +{formatRupiah(item.modifiersPriceDelta)} / pcs
          </span>
        ) : null}
      </div>
    </div>
  );
}
