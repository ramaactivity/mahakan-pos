"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/ui";
import type { MenuItem } from "@/features/menu";

export type MenuSortMode =
  | "default"
  | "name_asc"
  | "name_desc"
  | "price_asc"
  | "price_desc"
  | "signature_first";

const STORAGE_KEY = "mahakan-pos.menu-sort";

const SORT_OPTIONS = [
  { value: "default", label: "Urutan default" },
  { value: "name_asc", label: "Nama A → Z" },
  { value: "name_desc", label: "Nama Z → A" },
  { value: "price_asc", label: "Termurah dulu" },
  { value: "price_desc", label: "Termahal dulu" },
  { value: "signature_first", label: "Signature dulu" },
] as const;

/**
 * Hook with localStorage persistence — kasir setting carries across reloads
 * + tablet swap (per-device, not per-user). Default = "default" (DB
 * displayOrder), matches expected new-tablet behavior.
 */
export function useMenuSort(): [MenuSortMode, (m: MenuSortMode) => void] {
  const [mode, setMode] = useState<MenuSortMode>("default");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && isValidMode(stored)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMode(stored);
      }
    } catch {
      // localStorage may be blocked
    }
  }, []);

  function update(next: MenuSortMode) {
    setMode(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }
  return [mode, update];
}

function isValidMode(s: string): s is MenuSortMode {
  return (
    s === "default" ||
    s === "name_asc" ||
    s === "name_desc" ||
    s === "price_asc" ||
    s === "price_desc" ||
    s === "signature_first"
  );
}

interface MenuSortSelectProps {
  mode: MenuSortMode;
  onChange: (mode: MenuSortMode) => void;
  className?: string;
}

export function MenuSortSelect({
  mode,
  onChange,
  className,
}: MenuSortSelectProps) {
  return (
    <div className={className}>
      <Select
        ariaLabel="Urutan menu"
        size="sm"
        options={SORT_OPTIONS as unknown as Array<{ value: string; label: string }>}
        value={mode}
        onValueChange={(v) => onChange(v as MenuSortMode)}
      />
    </div>
  );
}

/**
 * Pure sort function — returns NEW array, doesn't mutate. Items with no
 * fixed/hot/iced price (e.g. open-price Manual Brew) sort to end on price
 * sorts to keep them out of "termurah" ranking.
 */
export function applyMenuSort(
  items: MenuItem[],
  mode: MenuSortMode,
): MenuItem[] {
  if (mode === "default") return items;
  const copy = [...items];
  if (mode === "name_asc") {
    copy.sort((a, b) => a.name.localeCompare(b.name, "id"));
  } else if (mode === "name_desc") {
    copy.sort((a, b) => b.name.localeCompare(a.name, "id"));
  } else if (mode === "price_asc") {
    copy.sort((a, b) => effectivePrice(a) - effectivePrice(b));
  } else if (mode === "price_desc") {
    copy.sort((a, b) => effectivePrice(b) - effectivePrice(a));
  } else if (mode === "signature_first") {
    copy.sort((a, b) => {
      const aSig = a.isSignature ? 1 : 0;
      const bSig = b.isSignature ? 1 : 0;
      if (aSig !== bSig) return bSig - aSig;
      return a.name.localeCompare(b.name, "id");
    });
  }
  return copy;
}

function effectivePrice(item: MenuItem): number {
  // Open-price items go to the end of "termurah" by treating as Infinity.
  if (item.priceType === "open") return Number.MAX_SAFE_INTEGER;
  if (item.priceType === "fixed") return item.priceFixed ?? 0;
  // Variant: prefer iced as cheaper-by-convention, fall back to hot.
  return item.priceIced ?? item.priceHot ?? 0;
}
