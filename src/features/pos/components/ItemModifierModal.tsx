"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Modal } from "@/components/ui";
import type { CartLineItemModifier } from "@/features/pos/types";
import { buildLineItem } from "@/features/pos/cartStore";
import {
  isOk,
  listModifiersForCategory,
  type MenuItem,
  type Modifier,
} from "@/features/menu";
import type { Variant } from "@/features/transactions";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ItemModifierModalProps {
  item: MenuItem | null;
  /** Resolved category name for snapshot in cart line. */
  categoryName: string;
  onClose: () => void;
  onAdd: (line: ReturnType<typeof buildLineItem>) => void;
}

export function ItemModifierModal({
  item,
  categoryName,
  onClose,
  onAdd,
}: ItemModifierModalProps) {
  const [modifiers, setModifiers] = useState<Modifier[]>([]);
  const [variant, setVariant] = useState<Variant | null>(null);
  const [selections, setSelections] = useState<Record<string, string | boolean>>(
    {},
  );

  // Reset state when item changes
  useEffect(() => {
    if (!item) return;
    const defaultVariant: Variant | null =
      item.priceType === "variant"
        ? item.priceHot !== null
          ? "hot"
          : item.priceIced !== null
            ? "iced"
            : null
        : null;
    // Reset on new item — sync with external trigger
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVariant(defaultVariant);
    setSelections({});
  }, [item]);

  useEffect(() => {
    if (!item) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setModifiers([]);
      return;
    }
    let cancelled = false;
    async function load() {
      const res = await listModifiersForCategory(item!.categoryId);
      if (cancelled || !isOk(res)) return;
      setModifiers(res.data.items);
      // Set default selections (single_select default = first option)
      const next: Record<string, string | boolean> = {};
      for (const mod of res.data.items) {
        if (mod.type === "single_select" && mod.optionsJson) {
          next[mod.slug] = mod.optionsJson[0].value;
        } else if (mod.type === "toggle") {
          next[mod.slug] = false;
        }
      }
      setSelections(next);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [item]);

  const unitPrice = useMemo(() => {
    if (!item) return 0;
    if (item.priceType === "fixed") return item.priceFixed ?? 0;
    if (item.priceType === "variant") {
      return variant === "hot"
        ? (item.priceHot ?? 0)
        : (item.priceIced ?? 0);
    }
    return 0;
  }, [item, variant]);

  const builtModifiers = useMemo<CartLineItemModifier[]>(() => {
    if (!item) return [];
    const out: CartLineItemModifier[] = [];
    for (const mod of modifiers) {
      if (mod.type === "single_select") {
        const value = selections[mod.slug] as string | undefined;
        if (!value) continue;
        // Skip ice_level if not iced variant
        if (mod.slug === "ice_level" && variant !== "iced") continue;
        const opt = mod.optionsJson?.find((o) => o.value === value);
        out.push({
          modifierSlug: mod.slug,
          label: mod.label,
          selectedValue: value,
          selectedLabel: opt?.label ?? value,
          priceDelta: 0,
        });
      } else if (mod.type === "toggle") {
        const on = selections[mod.slug] === true;
        if (!on) continue;
        out.push({
          modifierSlug: mod.slug,
          label: mod.label,
          selectedValue: "on",
          selectedLabel: mod.label,
          priceDelta: mod.price,
        });
      }
    }
    return out;
  }, [item, modifiers, selections, variant]);

  const modifiersDelta = builtModifiers.reduce((s, m) => s + m.priceDelta, 0);
  const lineTotal = unitPrice + modifiersDelta;

  if (!item) return null;

  function onSubmit() {
    if (!item) return;
    const line = buildLineItem({
      menuItemId: item.id,
      name: item.name,
      categoryName,
      variant,
      unitPrice,
      quantity: 1,
      modifiers: builtModifiers,
      note: null,
      openPriceNote: null,
    });
    onAdd(line);
    onClose();
  }

  // Variant pickers — only show available variants
  const variantOptions: Array<{ value: Variant; label: string; price: number | null }> =
    item.priceType === "variant"
      ? [
          { value: "hot", label: "Hot", price: item.priceHot },
          { value: "iced", label: "Iced", price: item.priceIced },
        ].filter((v) => v.price !== null) as Array<{
          value: Variant;
          label: string;
          price: number | null;
        }>
      : [];

  return (
    <Modal
      open={item !== null}
      onClose={onClose}
      title={item.name}
      description="Pilih variant dan modifier"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={onSubmit} size="lg">
            Tambah · {formatRupiah(lineTotal)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {variantOptions.length > 0 ? (
          <Group label="Variant">
            <div className="grid grid-cols-2 gap-2">
              {variantOptions.map((opt) => (
                <PickerButton
                  key={opt.value}
                  selected={variant === opt.value}
                  onClick={() => setVariant(opt.value)}
                  label={opt.label}
                  sub={opt.price ? formatRupiah(opt.price) : ""}
                />
              ))}
            </div>
          </Group>
        ) : null}

        {modifiers.map((mod) => {
          // Hide ice_level for non-iced variants
          if (mod.slug === "ice_level" && variant !== "iced") return null;

          if (mod.type === "single_select" && mod.optionsJson) {
            const selected = selections[mod.slug] as string | undefined;
            return (
              <Group key={mod.slug} label={mod.label}>
                <div className="grid grid-cols-3 gap-2">
                  {mod.optionsJson.map((opt) => (
                    <PickerButton
                      key={opt.value}
                      selected={selected === opt.value}
                      onClick={() =>
                        setSelections((s) => ({ ...s, [mod.slug]: opt.value }))
                      }
                      label={opt.label}
                    />
                  ))}
                </div>
              </Group>
            );
          }

          if (mod.type === "toggle") {
            const on = selections[mod.slug] === true;
            return (
              <Group key={mod.slug} label={mod.label}>
                <button
                  type="button"
                  onClick={() =>
                    setSelections((s) => ({ ...s, [mod.slug]: !on }))
                  }
                  className={cn(
                    "flex w-full items-center justify-between rounded-md border px-4 py-3 text-sm font-medium transition-all",
                    on
                      ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                      : "border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100",
                  )}
                >
                  <span>{on ? "Aktif" : "Nonaktif"}</span>
                  <span className="font-mono">
                    {on ? "+" : ""}
                    {formatRupiah(mod.price)}
                  </span>
                </button>
              </Group>
            );
          }
          return null;
        })}
      </div>
    </Modal>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-neutral-900">{label}</p>
      {children}
    </div>
  );
}

function PickerButton({
  selected,
  onClick,
  label,
  sub,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  sub?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-0.5 rounded-md border px-4 py-2.5 text-sm font-medium transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-2",
        selected
          ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
          : "border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100",
      )}
    >
      <span>{label}</span>
      {sub ? (
        <span className="font-mono text-xs text-neutral-500">{sub}</span>
      ) : null}
    </button>
  );
}
