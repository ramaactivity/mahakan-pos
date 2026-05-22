/**
 * Sesi AE-122 — Shared helpers untuk Catat Pembelian dan Tarik ke
 * Pembelian (dari PR). Sebelum AE-122, dua modal duplicate logic +
 * tidak konsisten (Tarik PR ga punya smart math, ga bisa edit unit).
 *
 * Helper ini pure (no DOM / no server). Aman di-import dari client.
 */

import type { IngredientPackConversion } from "@/lib/unit-conversion";
import { parseRupiah } from "@/lib/format";

/* Sesi AE — list satuan umum yang staff Mahakan biasa pakai.  Master
 * unit dari ingredient akan otomatis pre-select; staff bisa override
 * per-line (mis. master "Kg", staff input "gr" untuk belanja kecil). */
export const COMMON_PURCHASE_UNITS = [
  "Kg",
  "gr",
  "L",
  "ml",
  "Btl",
  "Pcs",
  "Packs",
  "Bks",
  "Krat",
  "Lusin",
  "Sdm",
  "Sdt",
  "Karton",
] as const;

/**
 * Build dropdown options unit: gabung COMMON_PURCHASE_UNITS + master unit
 * dari ingredient + ingredient-scoped pack conversions (Sesi AE-62af).
 */
export function buildPurchaseUnitOptions(
  masterUnit: string | undefined,
  ingredientPacks?: IngredientPackConversion[] | null,
): Array<{ value: string; label: string }> {
  const set = new Set<string>(COMMON_PURCHASE_UNITS);
  if (masterUnit) set.add(masterUnit);
  if (ingredientPacks && ingredientPacks.length > 0) {
    for (const p of ingredientPacks) {
      const label = p.unitLabel.trim();
      if (label.length > 0) set.add(label);
    }
  }
  return Array.from(set).map((u) => ({ value: u, label: u }));
}

/**
 * Parse decimal qty dari user input. Accept koma OR titik sebagai
 * separator (staff Indo biasa pakai koma di Sheets). Return NaN kalau
 * tidak valid.
 */
export function parsePurchaseQty(s: string): number {
  const cleaned = s.trim().replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Parse total bayar (rupiah). Accept "10.000", "10000", "Rp 10.000".
 * Selalu return finite number (0 fallback).
 */
export function parseTotalRupiah(s: string): number {
  const cleaned = String(s).trim().replace(/[^\d]/g, "");
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Safe wrapper di-pakai sebelumnya hanya di PurchaseFormModal.
 * Re-export untuk shared usage.
 */
export function parseRupiahSafe(s: string): number {
  try {
    return parseRupiah(s);
  } catch {
    return 0;
  }
}

/** Format qty: integer tanpa decimal, decimal dipotong trailing zero. */
export function formatPurchaseQty(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toFixed(4)));
}

/** Today di WIB sebagai YYYY-MM-DD. */
export function todayJakartaIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Sesi AE-78 — Smart math state untuk dual-input.
 *
 * User scenario (mirror Google Sheets):
 *   - input QTY + Harga/satuan → total auto
 *   - input QTY + Total Bayar → harga/satuan auto
 *
 * `inputMode` tracks mana yang user-typed (source of truth).
 */
export type SmartMathInputMode = "unit" | "total";

export interface SmartMathRow {
  qty: string;
  unitCost: string;
  total: string;
  inputMode: SmartMathInputMode;
}

/** Recompute row saat user ganti unitCost (mode = unit). */
export function applyUnitCostChange(
  row: SmartMathRow,
  newCost: string,
): SmartMathRow {
  const qtyN = parsePurchaseQty(row.qty);
  const costN = parseRupiahSafe(newCost);
  const newTotal =
    Number.isFinite(qtyN) && qtyN > 0 && costN >= 0
      ? String(Math.round(qtyN * costN))
      : row.total;
  return {
    ...row,
    unitCost: newCost,
    total: newTotal,
    inputMode: "unit",
  };
}

/** Recompute row saat user ganti total (mode = total). */
export function applyTotalChange(
  row: SmartMathRow,
  newTotal: string,
): SmartMathRow {
  const qtyN = parsePurchaseQty(row.qty);
  const totalN = parseTotalRupiah(newTotal);
  const newCost =
    Number.isFinite(qtyN) && qtyN > 0 && totalN >= 0
      ? String(Math.round(totalN / qtyN))
      : row.unitCost;
  return {
    ...row,
    total: newTotal,
    unitCost: newCost,
    inputMode: "total",
  };
}

/** Recompute row saat user ganti qty (preserve inputMode source of truth). */
export function applyQtyChange(
  row: SmartMathRow,
  newQty: string,
): SmartMathRow {
  const qtyN = parsePurchaseQty(newQty);
  if (!Number.isFinite(qtyN) || qtyN <= 0) {
    return { ...row, qty: newQty };
  }
  if (row.inputMode === "total" && row.total) {
    const totalN = parseTotalRupiah(row.total);
    const newCost =
      totalN >= 0 ? String(Math.round(totalN / qtyN)) : row.unitCost;
    return { ...row, qty: newQty, unitCost: newCost };
  }
  // default mode "unit" — recompute total kalau cost ada
  const costN = parseRupiahSafe(row.unitCost);
  if (costN >= 0) {
    return {
      ...row,
      qty: newQty,
      total: String(Math.round(qtyN * costN)),
    };
  }
  return { ...row, qty: newQty };
}
