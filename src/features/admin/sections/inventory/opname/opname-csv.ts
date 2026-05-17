import Papa from "papaparse";
import type { OpnameLineWithIngredient } from "@/features/stock-opname";
import { downloadCsv } from "../../reports/menu-engineering-csv";

/**
 * "Lembar Hitung" — count sheet for the staff to walk around the shop
 * with on paper / clipboard, then enter into the system afterwards.
 * actual_qty column is intentionally blank.
 */
export function downloadCountSheet(
  periodLabel: string,
  lines: OpnameLineWithIngredient[],
): void {
  const sorted = [...lines].sort((a, b) =>
    a.ingredientNameSnapshot.localeCompare(b.ingredientNameSnapshot, "id-ID"),
  );
  const rows = sorted.map((l, idx) => ({
    No: idx + 1,
    Bahan: l.ingredientNameSnapshot,
    Unit: l.unitSnapshot,
    "Qty Aktual": "",
    Catatan: "",
  }));
  const csv = Papa.unparse(rows, { newline: "\n" });
  // BOM so Excel opens UTF-8 names cleanly.
  const slug = periodLabel.toLowerCase().replace(/\s+/g, "-");
  downloadCsv(`opname-${slug}-lembar-hitung.csv`, "﻿" + csv);
}

/**
 * Result CSV — exported after a session is completed (or anytime for
 * audit). Includes expected, actual, diff, cost impact.
 */
export function downloadOpnameResult(
  periodLabel: string,
  lines: OpnameLineWithIngredient[],
): void {
  // Sesi AE-62e — prefer decimal mirror (real value, mungkin negative
  // dari oversold). Bigint di-clamp 0 untuk pass check constraint.
  const eff = (l: OpnameLineWithIngredient) => ({
    expected:
      l.expectedQtyDecimal !== null
        ? parseFloat(l.expectedQtyDecimal)
        : l.expectedQty,
    actual:
      l.actualQtyDecimal !== null
        ? parseFloat(l.actualQtyDecimal)
        : l.actualQty,
  });
  const sorted = [...lines].sort((a, b) => {
    const ea = eff(a);
    const eb = eff(b);
    const aDiff = ea.actual !== null ? Math.abs(ea.actual - ea.expected) : -1;
    const bDiff = eb.actual !== null ? Math.abs(eb.actual - eb.expected) : -1;
    if (aDiff !== bDiff) return bDiff - aDiff;
    return a.ingredientNameSnapshot.localeCompare(
      b.ingredientNameSnapshot,
      "id-ID",
    );
  });
  const rows = sorted.map((l, idx) => {
    const { expected, actual } = eff(l);
    const diff = actual !== null ? actual - expected : null;
    const costImpact = diff !== null ? diff * l.unitCostAtSnapshot : null;
    return {
      No: idx + 1,
      Bahan: l.ingredientNameSnapshot,
      Unit: l.unitSnapshot,
      "Qty Expected": expected,
      "Qty Aktual": actual ?? "",
      Selisih: diff ?? "",
      "Cost / Unit": l.unitCostAtSnapshot,
      "Dampak Biaya (Rp)": costImpact ?? "",
      Catatan: l.note ?? "",
    };
  });
  const csv = Papa.unparse(rows, { newline: "\n" });
  const slug = periodLabel.toLowerCase().replace(/\s+/g, "-");
  downloadCsv(`opname-${slug}-hasil.csv`, "﻿" + csv);
}
