/**
 * Sesi AE-122 — Shared helpers untuk Catat Pembelian dan Tarik ke
 * Pembelian (dari PR). Sebelum AE-122, dua modal duplicate logic +
 * tidak konsisten (Tarik PR ga punya smart math, ga bisa edit unit).
 *
 * Helper ini pure (no DOM / no server). Aman di-import dari client.
 */

import {
  convertQty,
  scaleCostOnUnitChange,
  type IngredientPackConversion,
} from "@/lib/unit-conversion";
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
 * Sesi AE-173 — Default satu baris saat "Tarik ke Pembelian" dari PR.
 *
 * Masalah yang diperbaiki: PR di-rekam staff dalam satuan COGS (mis. gram),
 * tapi owner belanja + ngisi harga dalam satuan belanja (mis. Kg). Sebelum
 * ini modal default ke satuan COGS lalu owner ngetik harga-per-kg → qty(gram)
 * × harga(per-kg) = total meledak (5.726 g × Rp 50.000 = Rp 286 juta).
 *
 * Aturan (mirror "Catat Pembelian"):
 *  - Kalau ingredient punya tier belanja valid (unit + perCogs > 0):
 *      unit     = satuan belanja (Kg)
 *      qty      = outstandingQty (COGS) ÷ perCogs  → 5726 g ÷ 1000 = 5.726 Kg
 *      unitCost = costPerUnit (per COGS) × perCogs → per Kg
 *  - Kalau tidak: pakai satuan COGS apa adanya (perilaku lama, tetap benar
 *    secara matematis — cuma ditampilkan dalam satuan kecil).
 *  - unitCost fallback ke suggested supplier cost kalau master cost = 0.
 *
 * Server (`createPurchase`) yang jadi source-of-truth: dia convert qty +
 * unitCost (lewat `convertPurchaseQty`) balik ke satuan COGS saat write,
 * termasuk bump `receivedQty` PR dalam satuan COGS. Helper ini murni untuk
 * default tampilan yang masuk akal buat owner.
 */
export interface PrLineDefaultInput {
  outstandingQty: number;
  /** Master cost per satuan COGS (Rp). 0 kalau belum ke-set. */
  costPerUnit: number;
  /** Suggested supplier cost (fallback). null kalau tak ada. */
  suggestedUnitCost: number | null;
  masterUnit: string;
  prUnit: string;
  /** Satuan belanja ter-validasi (null kalau tier belanja tak dipakai). */
  belanjaUnit: string | null;
  /** Faktor 1 satuan belanja = ? satuan COGS (>0), null kalau tak dipakai. */
  belanjaPerCogs: number | null;
}

export function computePrLineDefault(input: PrLineDefaultInput): {
  unit: string;
  qty: number;
  unitCost: number;
} {
  const perCogs =
    input.belanjaUnit &&
    input.belanjaPerCogs != null &&
    Number.isFinite(input.belanjaPerCogs) &&
    input.belanjaPerCogs > 0
      ? input.belanjaPerCogs
      : null;
  const useBelanja = perCogs != null;
  const unit = useBelanja
    ? input.belanjaUnit!
    : input.prUnit || input.masterUnit;
  const qty = useBelanja ? input.outstandingQty / perCogs : input.outstandingQty;
  /* Estimasi harga per satuan beli dari master cost (WAC) × konversi. Kena
   * pembulatan kalau cost_per_unit di-round (mis. 10.000/Pack ÷ 780ml = 12,82
   * → cpu 13 → ×780 = 10.140 ≠ 10.000). */
  const scaledMasterCost =
    input.costPerUnit > 0
      ? Math.round(input.costPerUnit * (useBelanja ? perCogs : 1))
      : 0;
  const supplierCost = input.suggestedUnitCost ?? 0;
  /* Sesi AE-177 — utamakan harga supplier ASLI (eksak, tanpa drift pembulatan)
   * kalau ADA dan DEKAT dengan estimasi master (≤5% → satuan sama, cuma beda
   * pembulatan). Kalau supplier jauh (kemungkinan satuan beda / data legacy)
   * atau tak ada estimasi, jatuh ke estimasi master. */
  const closeToMaster =
    scaledMasterCost === 0 ||
    Math.abs(supplierCost - scaledMasterCost) <= scaledMasterCost * 0.05;
  const unitCost =
    supplierCost > 0 && closeToMaster
      ? supplierCost
      : scaledMasterCost > 0
        ? scaledMasterCost
        : supplierCost;
  return { unit, qty, unitCost };
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

/**
 * Sesi AE-173 — Recompute row saat user GANTI SATUAN di form pembelian.
 *
 * Bug yang diperbaiki: dulu ganti satuan cuma scale HARGA, qty dibiarkan →
 * mis. 5.726 Kg diganti ke gr → qty tetap 5.726 (harusnya 5726) → total
 * salah (Rp 326 bukan Rp 326.382). Sekarang QTY ikut dikonversi.
 *
 * Aturan:
 *  - Same-dimension (Kg↔gr, L↔ml): qty dikonversi (×/÷ faktor) + harga
 *    di-scale terbalik → jumlah fisik & TOTAL tetap (invariant).
 *  - Beda dimensi / label custom (convertQty null): qty dibiarkan, cuma
 *    label satuan yang ganti (harga di-scale kalau bisa, else apa adanya).
 *  - Mode "total": total dikunci, harga = total ÷ qty-baru.
 */
export function applyUnitChange(
  row: SmartMathRow,
  oldUnit: string,
  newUnit: string,
): SmartMathRow {
  const qtyN = parsePurchaseQty(row.qty);
  const converted =
    row.qty.trim() !== "" && Number.isFinite(qtyN) && oldUnit
      ? convertQty(qtyN, oldUnit, newUnit)
      : null;
  const newQty = converted !== null ? formatPurchaseQty(converted) : row.qty;
  const qtyForCalc = parsePurchaseQty(newQty);

  if (row.inputMode === "total") {
    const totalN = parseTotalRupiah(row.total);
    const newCost =
      Number.isFinite(qtyForCalc) && qtyForCalc > 0 && totalN >= 0
        ? String(Math.round(totalN / qtyForCalc))
        : row.unitCost;
    return { ...row, qty: newQty, unitCost: newCost };
  }

  const scaled = scaleCostOnUnitChange({
    oldUnit,
    newUnit,
    oldCost: parseRupiahSafe(row.unitCost),
  });
  const newCost = scaled !== null ? String(Math.round(scaled)) : row.unitCost;
  const costForCalc = parseRupiahSafe(newCost);
  const newTotal =
    Number.isFinite(qtyForCalc) && qtyForCalc > 0 && costForCalc >= 0
      ? String(Math.round(qtyForCalc * costForCalc))
      : row.total;
  return { ...row, qty: newQty, unitCost: newCost, total: newTotal };
}
