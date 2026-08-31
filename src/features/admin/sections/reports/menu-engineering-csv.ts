/**
 * M23.6 polish: CSV builders for Menu Engineering Matrix export.
 * Client-side — uses papaparse already in deps.
 */
import Papa from "papaparse";
import type {
  MenuEngineeringResult,
  MenuQuadrant,
} from "@/features/reports";

const QUADRANT_LABEL: Record<MenuQuadrant, string> = {
  star: "Star",
  plowhorse: "Plowhorse",
  puzzle: "Puzzle",
  dog: "Dog",
  unclassified: "Belum diklasifikasi",
};

/**
 * Per-quadrant rollup CSV: 1 row per quadrant with count + sums.
 * Useful untuk Owner share quick summary via WhatsApp.
 */
export function buildSummaryCsv(result: MenuEngineeringResult): string {
  const buckets: Record<MenuQuadrant, { qty: number; revenue: number; cogs: number; contribMargin: number }> = {
    star: { qty: 0, revenue: 0, cogs: 0, contribMargin: 0 },
    plowhorse: { qty: 0, revenue: 0, cogs: 0, contribMargin: 0 },
    puzzle: { qty: 0, revenue: 0, cogs: 0, contribMargin: 0 },
    dog: { qty: 0, revenue: 0, cogs: 0, contribMargin: 0 },
    unclassified: { qty: 0, revenue: 0, cogs: 0, contribMargin: 0 },
  };
  for (const r of result.rows) {
    buckets[r.quadrant].qty += r.quantity;
    buckets[r.quadrant].revenue += r.revenue;
    if (r.cogs !== null) buckets[r.quadrant].cogs += r.cogs;
    if (r.contribMarginRp !== null) buckets[r.quadrant].contribMargin += r.contribMarginRp;
  }

  const order: MenuQuadrant[] = ["star", "puzzle", "plowhorse", "dog", "unclassified"];
  const data = order.map((q) => ({
    Quadrant: QUADRANT_LABEL[q],
    "Item Count": result.counts[q],
    "Total Qty": buckets[q].qty,
    "Revenue (Rp)": buckets[q].revenue,
    "HPP (Rp)": buckets[q].cogs,
    "Contrib. Margin (Rp)": buckets[q].contribMargin,
  }));

  return Papa.unparse(data, { newline: "\n" });
}

/**
 * Full per-row CSV: every menu row with quadrant + all metrics.
 * Useful untuk drill-down / pivot di Excel.
 */
export function buildRowsCsv(result: MenuEngineeringResult): string {
  const data = result.rows.map((r) => ({
    Item: r.name,
    Kategori: r.categoryName,
    Quadrant: QUADRANT_LABEL[r.quadrant],
    Qty: r.quantity,
    "Revenue (Rp)": r.revenue,
    "Avg/Unit (Rp)": r.averageOrderValue,
    "HPP (Rp)": r.cogs ?? "",
    "Contrib. Margin (Rp)": r.contribMarginRp ?? "",
    "Margin %": r.marginPct ?? "",
  }));
  return Papa.unparse(data, { newline: "\n" });
}

/** Trigger browser download for an in-memory CSV string. */
export function downloadCsv(filename: string, content: string): void {
  /* Sesi AE-224 — awali dengan BOM UTF-8. Tanpa ini Excel membaca file
   * sebagai ANSI, jadi huruf beraksen dan tanda "—" di nama menu berubah jadi
   * karakter aneh begitu dibuka. Dipasang di sini supaya seluruh tab laporan
   * yang memakai helper ini ikut terbetulkan sekaligus. */
  const blob = new Blob([`\ufeff${content}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
