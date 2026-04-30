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
  const sorted = [...lines].sort((a, b) => {
    const aDiff =
      a.actualQty !== null ? Math.abs(a.actualQty - a.expectedQty) : -1;
    const bDiff =
      b.actualQty !== null ? Math.abs(b.actualQty - b.expectedQty) : -1;
    if (aDiff !== bDiff) return bDiff - aDiff;
    return a.ingredientNameSnapshot.localeCompare(
      b.ingredientNameSnapshot,
      "id-ID",
    );
  });
  const rows = sorted.map((l, idx) => {
    const actual = l.actualQty;
    const diff = actual !== null ? actual - l.expectedQty : null;
    const costImpact = diff !== null ? diff * l.unitCostAtSnapshot : null;
    return {
      No: idx + 1,
      Bahan: l.ingredientNameSnapshot,
      Unit: l.unitSnapshot,
      "Qty Expected": l.expectedQty,
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
