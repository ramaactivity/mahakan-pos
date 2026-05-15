/**
 * Sesi AE-58 — Pure helpers untuk Inventory Monthly Flow di Bahan Baku page.
 * Reuse HppReportRow shape dari reports module, tapi pure logic untuk
 * status classification + grouping + totals. No DB / framework deps.
 */
import type { HppReportRow } from "@/features/reports";
import type { IngredientSection } from "./types";

/** Status indicator per row (accurate / partial / no_baseline). */
export type FlowStatus = "accurate" | "partial" | "no_baseline";

export function classifyFlowStatus(row: HppReportRow): FlowStatus {
  if (!row.partial) return "accurate";
  // Partial means salah satu sisi (Awal/Akhir) tidak punya opname.
  // Untuk gradasi: no_baseline = tidak ada baseline + tidak ada movement
  // (data trully reliable 0). Selain itu = partial (ada movement tapi
  // pakai fallback).
  if (row.stockAwalQty === 0 && row.pembelianQty === 0) {
    return "no_baseline";
  }
  return "partial";
}

/** Group rows by section enum. NULL section masuk grup "unassigned". */
export type SectionGroup = {
  section: IngredientSection | null;
  sectionLabel: string;
  rows: HppReportRow[];
  /** Totals subtotal untuk grup ini. */
  totals: {
    stockAwalCost: number;
    pembelianCost: number;
    stockAkhirCost: number;
    hppCost: number;
  };
};

const SECTION_LABEL: Record<IngredientSection, string> = {
  kitchen: "Kitchen",
  bar: "Bar",
  supporting: "Supporting Supplies",
  cleaning: "Cleaning Supplies",
};

/** Sort order: kitchen → bar → supporting → cleaning → null last. */
const SECTION_ORDER: Array<IngredientSection | null> = [
  "kitchen",
  "bar",
  "supporting",
  "cleaning",
  null,
];

export function groupRowsBySection(rows: HppReportRow[]): SectionGroup[] {
  const buckets = new Map<string, SectionGroup>();
  for (const row of rows) {
    const key = row.section ?? "__null__";
    let group = buckets.get(key);
    if (!group) {
      group = {
        section: row.section,
        sectionLabel: row.section
          ? SECTION_LABEL[row.section]
          : "Belum Di-section-kan",
        rows: [],
        totals: {
          stockAwalCost: 0,
          pembelianCost: 0,
          stockAkhirCost: 0,
          hppCost: 0,
        },
      };
      buckets.set(key, group);
    }
    group.rows.push(row);
    group.totals.stockAwalCost += row.stockAwalCost;
    group.totals.pembelianCost += row.pembelianCost;
    group.totals.stockAkhirCost += row.stockAkhirCost;
    group.totals.hppCost += row.hppCost;
  }

  const out: SectionGroup[] = [];
  for (const section of SECTION_ORDER) {
    const key = section ?? "__null__";
    const grp = buckets.get(key);
    if (grp) out.push(grp);
  }
  return out;
}

export function computeFlowTotals(rows: HppReportRow[]): {
  stockAwalCost: number;
  pembelianCost: number;
  stockAkhirCost: number;
  hppCost: number;
  rowCount: number;
  partialCount: number;
} {
  let stockAwalCost = 0;
  let pembelianCost = 0;
  let stockAkhirCost = 0;
  let hppCost = 0;
  let partialCount = 0;
  for (const r of rows) {
    stockAwalCost += r.stockAwalCost;
    pembelianCost += r.pembelianCost;
    stockAkhirCost += r.stockAkhirCost;
    hppCost += r.hppCost;
    if (r.partial) partialCount++;
  }
  return {
    stockAwalCost,
    pembelianCost,
    stockAkhirCost,
    hppCost,
    rowCount: rows.length,
    partialCount,
  };
}
