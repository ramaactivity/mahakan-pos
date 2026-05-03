import type { IngredientSection } from "./types";

/**
 * Per-section HPP estimate row — what gets surfaced di "Estimasi HPP" card
 * di OpnameCountView. Maps to Owner's P&L lines (sesi Z #2 enhancement):
 *   kitchen    → 5001 HPP - Bahan Makanan
 *   bar        → 5002 HPP - Bahan Minuman
 *   supporting → 5005 HPP - Perlengkapan
 *   cleaning   → 5006 HPP - Kemasan (Cup, Box, Lid)
 *   null       → "Belum diset" (Owner perlu klasifikasi via Inventory)
 *
 * Formula per ingredient: usedQty = openingQty + purchasesQty − closingQty
 * Cost: usedCost = usedQty × unitCost
 *   - openingQty pakai prior opname's unitCost (frozen)
 *   - purchasesCost pakai actual cost-per-purchase (frozen at purchase time)
 *   - closingQty (current opname's input) pakai unitCostAtSnapshot
 *
 * Negative usedQty = anomaly (closing > opening + purchases) — possible
 * causes: receiving belum dicatat, return ke supplier belum di-input, atau
 * miscount. Surface tapi jangan block submit.
 */

export interface HppEstimateRowInput {
  /** Ingredient section. Null → "unassigned" bucket. */
  section: IngredientSection | null;
  openingQty: number;
  openingUnitCost: number;
  purchasesCost: number;
  /** Closing qty (the count input) — null means uncounted, treat as 0
   * for now (Owner can decide later via "anggap sesuai expected" submit). */
  closingQty: number | null;
  closingUnitCost: number;
}

export interface HppEstimateSection {
  section: IngredientSection | null;
  /** Human label for the P&L line that this section maps to. */
  pnlLabel: string;
  /** Cost rupiah for this section. Can be negative when an outlier
   * pushes the section sum below zero (rare, surface tapi don't block). */
  hppCost: number;
  /** Count of ingredients aggregated here (informational). */
  lineCount: number;
}

const SECTION_PNL: Record<IngredientSection | "unassigned", string> = {
  kitchen: "5001 HPP - Bahan Makanan",
  bar: "5002 HPP - Bahan Minuman",
  supporting: "5005 HPP - Perlengkapan",
  cleaning: "5006 HPP - Kemasan",
  unassigned: "Belum diset (perlu klasifikasi)",
};

const SECTION_ORDER: Array<IngredientSection | "unassigned"> = [
  "kitchen",
  "bar",
  "supporting",
  "cleaning",
  "unassigned",
];

export function computeHppPerSection(
  rows: HppEstimateRowInput[],
): {
  bySection: HppEstimateSection[];
  grandTotal: number;
} {
  const accum = new Map<
    IngredientSection | "unassigned",
    { cost: number; count: number }
  >();

  for (const r of rows) {
    // closing null means uncounted → treat as zero usage so the estimate
    // doesn't get inflated by missing data. Once submitted with strict
    // mode, the row gets a real value.
    const closingQty = r.closingQty ?? 0;
    const openingCost = r.openingQty * r.openingUnitCost;
    const closingCost = closingQty * r.closingUnitCost;
    const usedCost = openingCost + r.purchasesCost - closingCost;

    const key = r.section ?? "unassigned";
    const cur = accum.get(key) ?? { cost: 0, count: 0 };
    cur.cost += usedCost;
    cur.count += 1;
    accum.set(key, cur);
  }

  const bySection: HppEstimateSection[] = [];
  let grandTotal = 0;
  for (const key of SECTION_ORDER) {
    const v = accum.get(key);
    if (!v) continue;
    bySection.push({
      section: key === "unassigned" ? null : (key as IngredientSection),
      pnlLabel: SECTION_PNL[key],
      hppCost: v.cost,
      lineCount: v.count,
    });
    grandTotal += v.cost;
  }

  return { bySection, grandTotal };
}
