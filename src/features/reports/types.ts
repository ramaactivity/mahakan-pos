import type { PaymentMethod } from "@/features/transactions";
import type { IngredientSection } from "@/features/inventory";
import type { PaymentMethod as PurchasePaymentMethod } from "@/features/purchases";

export type ApiResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: { code: string; message: string; field?: string };
    };

export function ok<T>(data: T): ApiResult<T> {
  return { success: true, data };
}
export function fail(
  code: string,
  message: string,
): ApiResult<never> {
  return { success: false, error: { code, message } };
}
export function isOk<T>(
  res: ApiResult<T>,
): res is { success: true; data: T } {
  return res.success === true;
}

export interface PaymentMethodBreakdown {
  method: PaymentMethod;
  count: number;
  amount: number;
}

export interface CategoryBreakdown {
  categoryName: string;
  count: number;
  revenue: number;
}

export interface TopItem {
  menuItemId: string;
  name: string;
  quantity: number;
  revenue: number;
}

export interface HourlyBucket {
  hour: number;
  count: number;
  revenue: number;
}

export interface DailySalesReport {
  date: string;
  metrics: {
    revenue: number;
    transactionCount: number;
    averageTicket: number;
    voidedCount: number;
    voidedAmount: number;
    refundedCount: number;
    refundedAmount: number;
  };
  byPaymentMethod: PaymentMethodBreakdown[];
  byCategory: CategoryBreakdown[];
  topItems: TopItem[];
  hourlyDistribution: HourlyBucket[];
}

/**
 * Range sales report — used for weekly / monthly views.
 *
 * `byDay` lists 1 entry per WIB day (gaps filled with zeros so the time-series
 * chart always shows the full range).
 *
 * `comparison` covers the *previous* period of equal length. Used to show
 * "+12% vs minggu lalu" deltas. Always present; if no prior data, `revenue: 0`.
 */
export interface SalesRangeReport {
  period: { from: string; to: string };
  metrics: {
    revenue: number;
    transactionCount: number;
    averageTicket: number;
    voidedCount: number;
    voidedAmount: number;
    refundedCount: number;
    refundedAmount: number;
  };
  byPaymentMethod: PaymentMethodBreakdown[];
  byCategory: CategoryBreakdown[];
  topItems: TopItem[];
  byDay: Array<{
    date: string;
    revenue: number;
    transactionCount: number;
  }>;
  comparison: {
    period: { from: string; to: string };
    revenue: number;
    transactionCount: number;
    /** % change vs prior period, signed; null when prior is 0. */
    revenueChangePct: number | null;
    transactionCountChangePct: number | null;
  };
}

export interface ItemPerformanceRow {
  menuItemId: string;
  name: string;
  categoryName: string;
  quantity: number;
  revenue: number;
  averageOrderValue: number;
  /** Sum of transaction_items.cogs across the date range; null if no item had a recipe. */
  cogs: number | null;
  /** Per-row margin (revenue - cogs) / revenue × 100; null if cogs unknown or revenue 0. */
  marginPct: number | null;
}

/**
 * Menu engineering quadrant labels (Kasavana-Smith framework).
 * - star:      high popularity + high contribution margin Rp → maintain & promote
 * - plowhorse: high popularity + low contribution margin → re-engineer cost / raise price
 * - puzzle:    low popularity + high contribution margin → improve marketing / positioning
 * - dog:       low popularity + low contribution margin → consider removing
 * - unclassified: insufficient data (no sales OR no cogs) — can't classify
 */
export type MenuQuadrant = "star" | "plowhorse" | "puzzle" | "dog" | "unclassified";

export interface MenuEngineeringRow extends ItemPerformanceRow {
  /** Total contribution margin Rp = (revenue - cogs); null when cogs unknown. */
  contribMarginRp: number | null;
  quadrant: MenuQuadrant;
}

export interface MenuEngineeringResult {
  rows: MenuEngineeringRow[];
  /** Linear-interpolation median of qty across CLASSIFIED rows (qty>0 && cogs). */
  medianQty: number | null;
  /** Linear-interpolation median of contribMarginRp across CLASSIFIED rows. */
  medianContribMargin: number | null;
  /** Aggregate sums across ALL rows (for header summary). */
  totals: {
    revenue: number;
    cogs: number;
    contribMargin: number;
  };
  /** Per-quadrant counts for header summary. */
  counts: Record<MenuQuadrant, number>;
  /** True when we have ≥4 classifiable items with non-trivial spread; otherwise classification skipped. */
  classified: boolean;
}

export interface PnlReport {
  period: { from: string; to: string };
  income: {
    posRevenue: number;
    manualIncome: number;
    total: number;
  };
  /** Sum of transactions.cogs for paid transactions in range. */
  cogs: number;
  /** total income − cogs (per accounting). */
  grossMargin: number;
  expenses: {
    byCategory: Array<{ name: string; amount: number }>;
    total: number;
  };
  /** total income − cogs − expenses (renamed: previously this field was income − expenses). */
  netProfit: number;
  disclaimer: string;
}

// ============================================================================
// HPP Report (Sesi O) — replaces Owner's COGS spreadsheet
// ============================================================================

export interface HppReportRow {
  ingredientId: string;
  name: string;
  unit: string;
  section: IngredientSection | null;
  stockAwalQty: number;
  stockAwalCost: number;
  pembelianQty: number;
  pembelianCost: number;
  stockAkhirQty: number;
  stockAkhirCost: number;
  /** = stockAwalQty + pembelianQty - stockAkhirQty (positive = consumed). */
  hppQty: number;
  /** = stockAwalCost + pembelianCost - stockAkhirCost. */
  hppCost: number;
  /** True kalau Stock Awal/Akhir di-derive dari current_stock (bukan opname).
   * UI surface ini sebagai warning. */
  partial: boolean;
}

export interface HppReport {
  period: { from: string; to: string };
  rows: HppReportRow[];
  totals: {
    stockAwalCost: number;
    pembelianCost: number;
    stockAkhirCost: number;
    hppCost: number;
  };
  /** Total HPP cost grouped by section, untuk dashboard/breakdown. */
  bySection: Array<{
    section: IngredientSection | null;
    sectionLabel: string;
    stockAwalCost: number;
    pembelianCost: number;
    stockAkhirCost: number;
    hppCost: number;
  }>;
  /** True kalau >= 1 row punya partial=true. UI banner. */
  hasPartialRows: boolean;
  /** Opname references actually used for stockAwal / stockAkhir. */
  opnameRefs: {
    stockAwalSessionId: string | null;
    stockAwalSessionDate: string | null;
    stockAkhirSessionId: string | null;
    stockAkhirSessionDate: string | null;
  };
}

// ============================================================================
// Purchase Rollup (Sesi O) — replaces Owner's Rekap Inv Detail
// ============================================================================

export interface PurchaseRollupCell {
  date: string; // YYYY-MM-DD
  section: IngredientSection | null;
  paymentMethod: PurchasePaymentMethod;
  totalAmount: number;
}

export interface PurchaseRollupReport {
  period: { from: string; to: string };
  /** Raw cells; UI bertanggung jawab pivot. */
  cells: PurchaseRollupCell[];
  /** Total grand sum across all rows × cols. */
  grandTotal: number;
  /** Per-date totals untuk rendering row footer. */
  byDate: Array<{ date: string; total: number }>;
  /** Per (section, paymentMethod) totals untuk col footer. */
  byColumn: Array<{
    section: IngredientSection | null;
    paymentMethod: PurchasePaymentMethod;
    total: number;
  }>;
}
