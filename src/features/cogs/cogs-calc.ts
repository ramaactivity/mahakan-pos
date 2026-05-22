/**
 * Sesi AE-113 — Pure functions untuk WAC (Weighted Average Cost) +
 * Variance Cost calculation per periode bulanan.
 *
 * Formulas (mirror Owner's Sheets spreadsheet):
 *
 *   averagePrice = (stockAwalTotal + pembelianTotal)
 *                  / (stockAwalQty + pembelianQty)
 *
 *   cogsQty    = stockAwalQty + pembelianQty - stockAkhirQty
 *   cogsTotal  = cogsQty × averagePrice
 *
 *   stockAkhirTotal = stockAkhirQty × averagePrice
 *
 *   variance  = actualUsage - theoreticalUsage
 *             where actualUsage = cogsQty
 *                   theoreticalUsage = Σ(recipe_qty × menu_sold_qty)
 *
 * Pure: no DB, no IO. Caller (server query) handles data fetching.
 */

export interface IngredientCogsInput {
  ingredientId: string;
  name: string;
  unit: string;
  section: "kitchen" | "bar" | "supporting" | "cleaning" | null;
  /** Stock awal qty (decimal, from prev opname or 0). */
  stockAwalQty: number;
  /** Harga avg dari periode sebelumnya (Rp/unit). Fallback ke costPerUnit
   * kalau no prev period. */
  stockAwalAvgPrice: number;
  /** Total qty pembelian bulan ini (decimal). */
  pembelianQty: number;
  /** Total Rp pembelian bulan ini. */
  pembelianTotal: number;
  /** Stock akhir qty dari opname bulan ini (decimal, 0 kalau no opname). */
  stockAkhirQty: number;
  /** Theoretical usage dari recipes × menu terjual (decimal). */
  theoreticalUsageQty: number;
  /** Current cost_per_unit (fallback kalau no data). */
  currentCostPerUnit: number;
}

export interface IngredientCogsRow {
  ingredientId: string;
  name: string;
  unit: string;
  section: "kitchen" | "bar" | "supporting" | "cleaning" | null;

  // Stock Awal
  stockAwalQty: number;
  stockAwalAvgPrice: number;
  stockAwalTotal: number;

  // Pembelian
  pembelianQty: number;
  pembelianAvgPrice: number;
  pembelianTotal: number;

  // Average Price (WAC bulan ini)
  averagePrice: number;

  // Stock Akhir
  stockAkhirQty: number;
  stockAkhirAvgPrice: number; // = averagePrice
  stockAkhirTotal: number;

  // COGS / Pemakaian
  cogsQty: number;
  cogsAvgPrice: number; // = averagePrice
  cogsTotal: number;

  // Variance
  theoreticalUsageQty: number;
  actualUsageQty: number; // = cogsQty
  varianceQty: number; // actualUsageQty - theoreticalUsageQty
  variancePct: number | null; // (variance / theoretical) × 100, null if theoretical=0
  varianceCost: number; // variance × averagePrice (Rp impact)

  /** Indicator kalau data tidak lengkap (e.g., no opname). */
  warnings: string[];
}

/**
 * Compute COGS row untuk satu ingredient untuk satu periode.
 */
export function computeIngredientCogs(
  input: IngredientCogsInput,
): IngredientCogsRow {
  const warnings: string[] = [];

  const stockAwalTotal = input.stockAwalQty * input.stockAwalAvgPrice;
  const pembelianAvgPrice =
    input.pembelianQty > 0 ? input.pembelianTotal / input.pembelianQty : 0;

  const totalQty = input.stockAwalQty + input.pembelianQty;
  const totalCost = stockAwalTotal + input.pembelianTotal;

  /* WAC bulan ini.
   * Fallback: kalau totalQty = 0 (no awal + no pembelian), pakai
   * currentCostPerUnit dari ingredients table. */
  let averagePrice: number;
  if (totalQty > 0) {
    averagePrice = totalCost / totalQty;
  } else {
    averagePrice = input.currentCostPerUnit;
    if (input.stockAkhirQty > 0 || input.theoreticalUsageQty > 0) {
      warnings.push(
        "No stock awal + no pembelian — averagePrice fallback ke cost_per_unit.",
      );
    }
  }

  const stockAkhirTotal = input.stockAkhirQty * averagePrice;

  const cogsQty = totalQty - input.stockAkhirQty;
  const cogsTotal = cogsQty * averagePrice;

  if (cogsQty < 0) {
    warnings.push(
      `Stock akhir (${input.stockAkhirQty}) > Stock awal + Pembelian (${totalQty}). Cek opname atau pembelian missing.`,
    );
  }

  // Variance
  const actualUsageQty = cogsQty;
  const varianceQty = actualUsageQty - input.theoreticalUsageQty;
  const variancePct =
    input.theoreticalUsageQty > 0
      ? (varianceQty / input.theoreticalUsageQty) * 100
      : null;
  const varianceCost = varianceQty * averagePrice;

  if (
    input.theoreticalUsageQty > 0 &&
    input.stockAkhirQty === 0 &&
    cogsQty > 0
  ) {
    // No opname → cogs assumes all used. Likely overstated.
    warnings.push(
      "Belum ada opname akhir periode — stock akhir di-asumsikan 0.",
    );
  }

  return {
    ingredientId: input.ingredientId,
    name: input.name,
    unit: input.unit,
    section: input.section,

    stockAwalQty: input.stockAwalQty,
    stockAwalAvgPrice: input.stockAwalAvgPrice,
    stockAwalTotal: round(stockAwalTotal),

    pembelianQty: input.pembelianQty,
    pembelianAvgPrice: round(pembelianAvgPrice),
    pembelianTotal: round(input.pembelianTotal),

    averagePrice: round(averagePrice),

    stockAkhirQty: input.stockAkhirQty,
    stockAkhirAvgPrice: round(averagePrice),
    stockAkhirTotal: round(stockAkhirTotal),

    cogsQty: round(cogsQty, 4),
    cogsAvgPrice: round(averagePrice),
    cogsTotal: round(cogsTotal),

    theoreticalUsageQty: round(input.theoreticalUsageQty, 4),
    actualUsageQty: round(actualUsageQty, 4),
    varianceQty: round(varianceQty, 4),
    variancePct: variancePct !== null ? round(variancePct, 2) : null,
    varianceCost: round(varianceCost),
    warnings,
  };
}

function round(n: number, decimals = 0): number {
  if (!Number.isFinite(n)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

// ──────────────────────────────────────────────────────────────────
// Period helpers
// ──────────────────────────────────────────────────────────────────

export interface MonthlyPeriod {
  /** YYYY-MM format, e.g., "2026-05". */
  ym: string;
  /** WIB date YYYY-MM-DD inclusive. */
  fromDate: string;
  /** WIB date YYYY-MM-DD inclusive (last day of month). */
  toDate: string;
  /** Display label like "Mei 2026". */
  label: string;
}

const MONTH_NAMES_ID = [
  "Januari", "Februari", "Maret", "April",
  "Mei", "Juni", "Juli", "Agustus",
  "September", "Oktober", "November", "Desember",
];

export function parseMonthlyPeriod(ym: string): MonthlyPeriod {
  if (!/^\d{4}-\d{2}$/.test(ym)) {
    throw new Error(`Invalid period format '${ym}'. Expected YYYY-MM.`);
  }
  const [yearStr, monthStr] = ym.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month '${month}'. Must be 1-12.`);
  }
  const fromDate = `${ym}-01`;
  // Last day of month: day 0 of next month
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const toDate = `${ym}-${String(lastDay).padStart(2, "0")}`;
  const label = `${MONTH_NAMES_ID[month - 1]} ${year}`;
  return { ym, fromDate, toDate, label };
}

export function previousMonth(ym: string): string {
  const [yearStr, monthStr] = ym.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  if (month === 1) {
    return `${year - 1}-12`;
  }
  return `${year}-${String(month - 1).padStart(2, "0")}`;
}

// ──────────────────────────────────────────────────────────────────
// Aggregate summary
// ──────────────────────────────────────────────────────────────────

export interface CogsSummary {
  total: number;
  bySection: {
    kitchen: number;
    bar: number;
    supporting: number;
    cleaning: number;
    unassigned: number;
  };
  totalVarianceCost: number;
  ingredientsWithVariance: number; // count of bahan dengan variance != 0
}

export function summarizeCogs(rows: IngredientCogsRow[]): CogsSummary {
  const bySection = {
    kitchen: 0,
    bar: 0,
    supporting: 0,
    cleaning: 0,
    unassigned: 0,
  };
  let total = 0;
  let totalVarianceCost = 0;
  let ingredientsWithVariance = 0;

  for (const r of rows) {
    total += r.cogsTotal;
    if (r.section) {
      bySection[r.section] += r.cogsTotal;
    } else {
      bySection.unassigned += r.cogsTotal;
    }
    if (r.varianceQty !== 0) {
      ingredientsWithVariance++;
      totalVarianceCost += r.varianceCost;
    }
  }

  return {
    total: round(total),
    bySection: {
      kitchen: round(bySection.kitchen),
      bar: round(bySection.bar),
      supporting: round(bySection.supporting),
      cleaning: round(bySection.cleaning),
      unassigned: round(bySection.unassigned),
    },
    totalVarianceCost: round(totalVarianceCost),
    ingredientsWithVariance,
  };
}
