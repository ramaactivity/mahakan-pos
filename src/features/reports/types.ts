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
    /** Sesi AE-62 — true kalau row ini berasal dari historical_daily_summary
     *  (data import dari Majoo/Kasir Pintar), bukan transactions live. UI
     *  badge kuning "Histori" + sourceLabel kalau ada. */
    isHistorical?: boolean;
    sourceLabel?: string | null;
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
    /** Sesi AE-62 — net revenue dari historical_daily_summary di range. */
    historicalIncome: number;
    total: number;
  };
  /** Sum of transactions.cogs for paid transactions in range. Live POS only. */
  cogs: number;
  /** Sesi AE-62 — historical_daily_summary.cogs aggregate di range. */
  historicalCogs: number;
  /** total income − (cogs + historicalCogs). */
  grossMargin: number;
  expenses: {
    byCategory: Array<{ name: string; amount: number }>;
    /** Sesi AE-62 — total historical_expense.amount aggregate di range. */
    historicalTotal: number;
    total: number;
  };
  /** total income − all cogs − all expenses. */
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
  /**
   * Sesi AE-202 — stok akhir BELUM DIKETAHUI: periode ini belum punya opname
   * DAN mode persediaan periodic, sehingga `current_stock` beku di angka
   * opname terakhir. Memakainya sebagai stok akhir membuat pemakaian =
   * seluruh pembelian. Saat true, `stockAkhirQty/Cost` + `hppQty/Cost` = 0
   * dan UI WAJIB menampilkan "—".
   */
  stockAkhirUnknown: boolean;
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
  /**
   * Sesi AE-202 — periode ini belum punya opname DAN mode persediaan periodic
   * → stok akhir (dan karenanya HPP) belum bisa dihitung sama sekali. UI WAJIB
   * menampilkan "—", bukan Rp 0.
   */
  stockAkhirUnknown: boolean;
  /**
   * Sesi AE-207 — periode ini ada SEBELUM batas buku (`booksCutoff`).
   *
   * Angka laporan sengaja TIDAK di-floor: rumus `awal + beli − akhir` memakai
   * stok dari opname, yang tidak bisa di-floor di tanggal yang sama. Kalau cuma
   * sisi pembelian yang di-floor, pemakaian jadi MELAMBUNG (failure mode
   * AE-202/AE-194). Jadi angkanya benar secara internal, tapi TIDAK nyambung
   * dengan Neraca & Laba Rugi yang berlaku → UI wajib memberi peringatan.
   */
  beforeCutoff: boolean;
  /** Opname references actually used for stockAwal / stockAkhir. */
  opnameRefs: {
    stockAwalSessionId: string | null;
    stockAwalSessionDate: string | null;
    stockAkhirSessionId: string | null;
    stockAkhirSessionDate: string | null;
  };
}

// ============================================================================
// Sesi AE-55 — Closing Shift Report
// ============================================================================

export interface ClosingShiftRow {
  shiftId: string;
  shiftDate: string; // YYYY-MM-DD WIB (dari closedAt)
  openedAt: string; // ISO
  closedAt: string; // ISO
  durationMinutes: number;
  userId: string;
  userName: string;
  openingCash: number;
  paidCash: number;
  refundedCash: number;
  expectedCash: number;
  actualCash: number;
  variance: number;
  edcSettlement: number;
  gofoodSettlement: number;
  grabfoodSettlement: number;
  shopeefoodSettlement: number;
  settlementTotal: number;
  /* ---- Sesi AE-224 — non-tunai ikut direkonsiliasi, bukan cuma kas ----
   *
   * Laporan ini sebelumnya hanya mengadu Kas Harusnya vs Kas Aktual. QRIS
   * bahkan tidak pernah ikut terbaca padahal kolomnya sudah lama ada di tabel
   * shifts, jadi shift yang penjualannya mayoritas QRIS terlihat seolah nyaris
   * tanpa pemasukan. Sekarang QRIS dan kartu/debit diperlakukan sama seperti
   * kas: yang SEHARUSNYA (dari transaksi, sudah termasuk pecahan split) diadu
   * dengan yang DILAPORKAN kasir saat tutup shift. */
  /** QRIS menurut transaksi shift ini. */
  expectedQris: number;
  /** QRIS yang dilaporkan kasir saat tutup (shifts.qris_settlement). */
  qrisSettlement: number;
  qrisVariance: number;
  /** Kartu/debit (EDC) menurut transaksi shift ini. */
  expectedCard: number;
  /** Selisih EDC dilaporkan vs seharusnya. */
  cardVariance: number;
  /** GoFood + GrabFood + ShopeeFood. */
  aggregatorTotal: number;
  /**
   * Total yang benar-benar ditutup shift ini = kas aktual + QRIS + EDC +
   * aggregator. Ini angka "total closing" yang dicari owner: berapa nilai
   * seluruh pemasukan shift, bukan cuma laci kasnya.
   */
  totalClosing: number;
  notes: string | null;
}

export interface ClosingShiftReport {
  period: { from: string; to: string };
  rows: ClosingShiftRow[];
  totals: {
    shiftCount: number;
    totalPaidCash: number;
    totalActualCash: number;
    totalVariance: number;
    totalSettlement: number;
    /** Sesi AE-224 — total per kanal + total closing seluruh periode. */
    totalQris: number;
    totalCard: number;
    totalAggregator: number;
    totalClosing: number;
    /** Jumlah shift yang QRIS/kartunya tidak cocok dengan transaksi. */
    nonCashMismatchCount: number;
    avgVariance: number;
    biggestPositiveVariance: number;
    biggestNegativeVariance: number;
    /** Count shift dengan |variance| > thresholdAlert */
    overThresholdCount: number;
  };
  varianceThreshold: number;
}

// ============================================================================
// Sesi AE-55 — Per-Bill Report
// ============================================================================

export type BillBucketKey = "small" | "medium" | "large" | "premium";

export interface BillBucket {
  key: BillBucketKey;
  label: string;
  min: number;
  max: number | null; // null = no upper bound
  count: number;
  revenue: number;
  pctOfCount: number;
}

export interface BillRow {
  transactionId: string;
  transactionNumber: string;
  closedAt: string; // ISO
  userId: string | null;
  userName: string | null;
  customerName: string | null;
  total: number;
  refundedAmount: number;
  netTotal: number;
  paymentMethod: PaymentMethod;
  status: "paid" | "partially_refunded";
  /** Sesi AE-234 — open bill trail. closedAt above is actually the time the
   *  bill was OPENED (created_at); paidAt is when it was closed/paid. */
  paidAt: string | null;
  isOpenBill: boolean;
  editCount: number;
  /** Highest total the bill ever reached before payment. */
  peakTotal: number;
  /** peakTotal − total; > 0 means items were removed after ordering. */
  reducedBy: number;
  items: string;
  cashReceived: number | null;
  cashChange: number | null;
  discountAmount: number;
  discountReason: string | null;
}

export interface BillStats {
  count: number;
  totalRevenue: number;
  avgBill: number;
  medianBill: number;
  minBill: number;
  maxBill: number;
  /** Histogram bucket dengan count terbanyak (untuk display "mayoritas bill X"). */
  modeBucket: BillBucketKey | null;
}

export interface BillPerformanceReport {
  period: { from: string; to: string };
  paymentFilter: PaymentMethod | "all";
  stats: BillStats;
  buckets: BillBucket[];
  rows: BillRow[];
  /** True kalau hasil dipotong (>1000 row). */
  truncated: boolean;
}

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

// ============================================================================
// Sesi AE-59 — Refund / Void / Compliment Report
// ============================================================================

export type RefundVoidComplimentKind =
  | "refund_full"
  | "refund_partial"
  | "void"
  | "compliment";

export interface RefundVoidComplimentEvent {
  /** refund_events.id ATAU transactions.id (untuk void/compliment). */
  eventId: string;
  kind: RefundVoidComplimentKind;
  transactionId: string;
  transactionNumber: string;
  /** ISO timestamp. */
  occurredAt: string;
  cashierName: string | null;
  customerName: string | null;
  approverName: string | null;
  reason: string | null;
  /** Refund: refund_events.totalRefunded. Void: transaction.total. Compliment: discountAmount. */
  amountImpact: number;
  /** Sum item.cogs untuk compliment + partial refund. 0 untuk void (stock restored). */
  cogsImpact: number;
  itemCount: number;
}

export type RvcAnomalyType =
  | "frequent_refund_kasir"
  | "repeated_item_void"
  | "compliment_burst"
  | "integrity_mismatch";

export type RvcAnomalySeverity = "info" | "warning" | "danger";

export interface RvcAnomaly {
  type: RvcAnomalyType;
  severity: RvcAnomalySeverity;
  message: string;
}

export interface RvcTotals {
  refundFullCount: number;
  refundFullAmount: number;
  refundPartialCount: number;
  refundPartialAmount: number;
  voidCount: number;
  voidAmount: number;
  complimentCount: number;
  complimentAmount: number;
  complimentCogsImpact: number;
  grandEventCount: number;
  grandAmount: number;
}

export interface RefundVoidComplimentReport {
  period: { from: string; to: string };
  events: RefundVoidComplimentEvent[];
  totals: RvcTotals;
  anomalies: RvcAnomaly[];
  /** True kalau hasil dipotong (>1000 events). */
  truncated: boolean;
}

export interface RvcDetailItem {
  itemName: string;
  qty: number;
  unitPrice: number;
  amountImpact: number;
  cogsAmount: number;
}

export interface RvcDetailAuditEntry {
  eventType: string;
  actor: string;
  occurredAt: string;
  summary: string;
}

export interface RvcInventoryImpact {
  restored: boolean;
  warning: string | null;
}

export interface RefundVoidComplimentDetail {
  event: RefundVoidComplimentEvent;
  items: RvcDetailItem[];
  originalTransaction: {
    transactionNumber: string;
    total: number;
    refundedAmount: number;
    status: string;
    closedAt: string;
    paymentMethod: string;
  };
  auditTrail: RvcDetailAuditEntry[];
  inventoryImpact: RvcInventoryImpact;
}
