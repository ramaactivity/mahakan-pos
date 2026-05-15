/**
 * Sesi AE-58 — CSV builder untuk export Inventory Monthly Flow ke format
 * mirror Google Sheets "COGS" sheet lama. Per kategori (Kitchen / Bar /
 * Supporting Supplies / Cleaning Supplies) dengan header row + items +
 * subtotal per group. No DB / framework deps.
 */
import Papa from "papaparse";
import type { HppReportRow } from "@/features/reports";
import { groupRowsBySection } from "@/features/inventory/monthly-flow-pure";

interface CsvRow {
  No: string;
  Nama: string;
  Section?: string;
  "Harga Avg"?: number | string;
  "Stock Awal Qty"?: number | string;
  "Stock Awal Total"?: number | string;
  "Pembelian Qty"?: number | string;
  "Pembelian Total"?: number | string;
  "Stock Akhir Qty"?: number | string;
  "Stock Akhir Total"?: number | string;
  "HPP Qty"?: number | string;
  "HPP Total"?: number | string;
  Status?: string;
}

function avgPrice(qty: number, total: number): number {
  return qty > 0 ? Math.round(total / qty) : 0;
}

/* Build CSV string mirror format Google Sheets COGS:
 *   [Section Header Row]
 *   No | Nama | Stock Awal Qty | Total | Pembelian Qty | Total | ...
 *   1 | Beras | 10 | 100k | 5 | 50k | ...
 *   ...
 *   Subtotal | | | 1.5jt | | 800k | ...
 *   [Next Section]
 *   ...
 *   GRAND TOTAL | | | 16.244.352 | | 4.971.136 | ... | HPP 11.273.217
 */
export function buildCogsCsv(rows: HppReportRow[], yyyymm: string): string {
  const groups = groupRowsBySection(rows);

  const records: Array<CsvRow> = [];

  let grandStockAwal = 0;
  let grandPembelian = 0;
  let grandStockAkhir = 0;
  let grandHpp = 0;

  for (const grp of groups) {
    // Section header row (visual divider)
    records.push({
      No: "",
      Nama: grp.sectionLabel.toUpperCase(),
    });
    records.push({
      No: "No",
      Nama: "Nama",
      "Harga Avg": "Harga Avg",
      "Stock Awal Qty": "Stock Awal Qty",
      "Stock Awal Total": "Stock Awal Total",
      "Pembelian Qty": "Pembelian Qty",
      "Pembelian Total": "Pembelian Total",
      "Stock Akhir Qty": "Stock Akhir Qty",
      "Stock Akhir Total": "Stock Akhir Total",
      "HPP Qty": "HPP Qty",
      "HPP Total": "HPP Total",
      Status: "Status",
    });

    let idx = 1;
    for (const row of grp.rows) {
      records.push({
        No: String(idx++),
        Nama: row.name,
        "Harga Avg": avgPrice(row.stockAwalQty, row.stockAwalCost),
        "Stock Awal Qty": row.stockAwalQty,
        "Stock Awal Total": row.stockAwalCost,
        "Pembelian Qty": row.pembelianQty,
        "Pembelian Total": row.pembelianCost,
        "Stock Akhir Qty": row.stockAkhirQty,
        "Stock Akhir Total": row.stockAkhirCost,
        "HPP Qty": row.hppQty,
        "HPP Total": row.hppCost,
        Status: row.partial ? "Partial" : "Akurat",
      });
    }

    // Subtotal per group
    records.push({
      No: "",
      Nama: `Subtotal ${grp.sectionLabel}`,
      "Stock Awal Total": grp.totals.stockAwalCost,
      "Pembelian Total": grp.totals.pembelianCost,
      "Stock Akhir Total": grp.totals.stockAkhirCost,
      "HPP Total": grp.totals.hppCost,
    });

    grandStockAwal += grp.totals.stockAwalCost;
    grandPembelian += grp.totals.pembelianCost;
    grandStockAkhir += grp.totals.stockAkhirCost;
    grandHpp += grp.totals.hppCost;

    // Blank separator
    records.push({ No: "", Nama: "" });
  }

  // Grand total
  records.push({
    No: "",
    Nama: `GRAND TOTAL (${yyyymm})`,
    "Stock Awal Total": grandStockAwal,
    "Pembelian Total": grandPembelian,
    "Stock Akhir Total": grandStockAkhir,
    "HPP Total": grandHpp,
  });

  return Papa.unparse(records, { newline: "\n" });
}
