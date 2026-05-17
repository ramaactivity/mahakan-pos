import type { InferSelectModel } from "drizzle-orm";
import type {
  cashDeposits,
  aggregatorSettlements,
} from "@/db/schema";

export type CashDeposit = InferSelectModel<typeof cashDeposits>;
export type AggregatorSettlement = InferSelectModel<
  typeof aggregatorSettlements
>;

export type CashDepositStatus =
  | "pending_verification"
  | "verified"
  | "rejected";

/* Sesi AE-56 — tambah "cash" sebagai virtual channel. Tidak ke-save di
 * aggregator_settlements (cash flow lewat cash_deposits), tapi tampil di
 * rekonsiliasi tabel + drill-down + status tracking. */
export type AggregatorChannel =
  | "cash"
  | "edc_bca"
  | "gofood"
  | "grabfood"
  | "shopeefood"
  | "qris";

/** Sesi AE-56 — channel yang valid untuk aggregator_settlements input.
 * Excludes 'cash' karena cash punya flow sendiri (cash_deposits). */
export type AggregatorSettlementChannel = Exclude<AggregatorChannel, "cash">;

export type ReconciliationStatus =
  | "open"
  | "investigating"
  | "resolved"
  | "disputed";

export type ReconciliationAnomalySeverity = "info" | "warning" | "danger";

export type ReconciliationAnomalyType =
  | "large_variance"
  | "settlement_missing"
  | "recurring_pattern"
  | "cash_leak"
  | "negative_cash";

export type ReconciliationAnomaly = {
  type: ReconciliationAnomalyType;
  severity: ReconciliationAnomalySeverity;
  channel: AggregatorChannel;
  message: string;
};

// ---------- API result helpers ----------

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

export function fail(code: string, message: string): ApiResult<never> {
  return { ok: false, error: { code, message } };
}

// ---------- Inputs ----------

export type CreateCashDepositInput = {
  depositDate: string; // YYYY-MM-DD
  amount: number;
  bankDestination: string;
  referenceNo?: string | null;
  photoUrl?: string | null;
  notes?: string | null;
  coversFromDate: string; // YYYY-MM-DD
  coversToDate: string; // YYYY-MM-DD
};

export type UpdateCashDepositInput = {
  id: string;
  depositDate?: string;
  amount?: number;
  bankDestination?: string;
  referenceNo?: string | null;
  photoUrl?: string | null;
  notes?: string | null;
  coversFromDate?: string;
  coversToDate?: string;
};

export type VerifyCashDepositInput = {
  id: string;
  acknowledgeNegativeCash?: boolean;
};
export type RejectCashDepositInput = { id: string; reason: string };
export type UnverifyCashDepositInput = { id: string; reason: string };

export type CreateAggregatorSettlementInput = {
  channel: AggregatorChannel;
  periodFrom: string;
  periodTo: string;
  grossAmount: number;
  feeAmount?: number;
  bankCreditedAt?: Date | string | null;
  referenceNo?: string | null;
  notes?: string | null;
};

export type UpdateAggregatorSettlementInput = {
  id: string;
  channel?: AggregatorChannel;
  periodFrom?: string;
  periodTo?: string;
  grossAmount?: number;
  feeAmount?: number;
  bankCreditedAt?: Date | string | null;
  referenceNo?: string | null;
  notes?: string | null;
};

// ---------- Reports ----------

export type ShiftSettlementRow = {
  shiftId: string;
  cashierId: string;
  cashierName: string;
  openedAt: Date;
  closedAt: Date | null;
  openingCash: number;
  actualCash: number | null;
  expectedCash: number | null;
  cashVariance: number | null;

  cashSales: number;
  cashExpenses: number;
  cardBcaActual: number;
  qrisActual: number;
  refundedCash: number;

  edcReported: number | null;
  gofoodReported: number | null;
  grabfoodReported: number | null;
  shopeefoodReported: number | null;

  edcVariance: number | null; // edcReported - cardBcaActual
};

export type DailySettlementReport = {
  date: string; // YYYY-MM-DD WIB
  shifts: ShiftSettlementRow[];
  totals: {
    openingCash: number;
    cashSales: number;
    cashExpenses: number;
    refundedCash: number;
    actualCashCounted: number;
    expectedCash: number;
    cashVariance: number;

    cardBcaActual: number;
    qrisActual: number;

    edcReported: number;
    gofoodReported: number;
    grabfoodReported: number;
    shopeefoodReported: number;

    edcVariance: number;

    transactionCount: number;
    paidCount: number;
    voidedCount: number;
    refundedCount: number;
  };
};

// ---------- Cash on hand ----------

export type CashOnHandSnapshot = {
  outletId: string;
  asOf: Date;
  /** Earliest day not yet covered by a verified deposit. */
  unsettledFromDate: string | null;
  /**
   * Sesi AE-62f — Σ(cashSales − cashExpenses − refundedCash) untuk closed
   * shifts dalam [unsettledFromDate, today]. openingCash TIDAK include
   * (petty cash float carryover, bukan injection).
   */
  unsettledClosedShiftsCash: number;
  /** Sum of pending deposits in window (informational). */
  pendingDepositsAmount: number;
  /** Sum of verified deposits in window (already subtracted from balance). */
  verifiedDepositsAmount: number;
  /** Open shift drawer cash (excluded from balance). */
  openShiftDrawerCash: number;
  /**
   * Sesi AE-62f — petty cash float (laci kasir) yang carryover antar shift.
   * Max(openingCash) dari closed shifts dalam window — informational only,
   * NOT included di cashOnHand. UI surface "Rp 200rb di laci tetap kasir,
   * bukan setoran-able".
   */
  pettyCashFloat: number;
  /** Final cash-on-hand = unsettledClosedShiftsCash − verifiedDepositsAmount. Pending deposits NOT subtracted. */
  cashOnHand: number;
  thresholdIdr: number;
  isOverThreshold: boolean;
  pendingDepositCount: number;
};

// ---------- Cash flow ledger ----------

export type CashFlowEntryKind =
  | "expense_manual"
  | "expense_purchase"
  | "expense_payroll"
  | "expense_refund"
  | "income_manual"
  | "deposit_verified";

export type CashFlowEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  kind: CashFlowEntryKind;
  description: string;
  paymentMethod: "cash" | "transfer" | "other" | null;
  amount: number; // negative for outflow, positive for inflow
  referenceId: string | null; // payrollPeriodId/purchaseId/transactionId
  createdBy: string | null;
};

export type CashFlowLedgerReport = {
  rangeFrom: string;
  rangeTo: string;
  entries: CashFlowEntry[];
  totals: {
    inflowTotal: number;
    outflowTotal: number;
    netFlow: number;
    byKind: Record<CashFlowEntryKind, number>;
  };
};

// ---------- Cash deposit dashboard (sesi AE-8) ----------

/**
 * Per-day rollup mirror screenshot DAILY CASHIER REPORT spreadsheet.
 * Formula: sisaAkhir = sisaAwal + cashSales - cashExpenses - depositsVerified.
 */
export type CashDailyRollup = {
  date: string; // YYYY-MM-DD WIB
  sisaAwal: number; // carryover from previous day
  cashSales: number; // total kas tunai (paid - refunded)
  cashExpenses: number; // petty cash expenses (cash payment method)
  depositsVerified: number; // verified deposits with depositDate = this day
  depositsPending: number; // pending deposits with depositDate = this day
  sisaAkhir: number; // sisaAwal + cashSales - cashExpenses - depositsVerified
  shiftCount: number; // closed shifts on this day
};

export type CashDepositDashboard = {
  asOf: Date;
  cashOnHand: number; // dari getCashOnHand
  outstandingToDeposit: number; // cashOnHand - pendingDepositsAmount (kas yang belum disetor)
  pendingCount: number;
  pendingTotal: number; // sum pending deposits awaiting verify
  lastVerified: {
    id: string;
    depositDate: string;
    amount: number;
    bankDestination: string;
    verifierName: string | null;
    verifiedAt: Date;
  } | null;
  totalDepositedThisMonth: number;
  thresholdIdr: number;
  isOverThreshold: boolean;
  /** Last 30 days daily rollup, oldest first. Mirror spreadsheet pattern. */
  last30DaysFlow: CashDailyRollup[];
  // Sesi AE-10 anti-fraud guards:
  /** Days since the oldest still-pending deposit was created. NULL kalau ga
   * ada pending. Owner banner triggered kalau > 3 days. */
  oldestPendingDays: number | null;
  /** True kalau computed cashOnHand < 0 (data inconsistency / anomaly).
   * Critical banner — biasanya artinya ada deposit yang harusnya rejected
   * tapi keburu di-verify, atau cash leak yang ga ke-record. */
  isCashNegative: boolean;
};

// ---------- Reconciliation ----------

export type SettlementReconciliationRow = {
  channel: AggregatorChannel;
  reportedFromShifts: number; // sum from shifts.{channel}Settlement (kasir-reported)
  posActual: number; // sum from transactions for matchable channels
  aggregatorGross: number; // sum from aggregator_settlements.grossAmount
  aggregatorFee: number;
  aggregatorNet: number;
  varianceShiftsVsAggregator: number; // reportedFromShifts - aggregatorGross
  variancePosVsAggregator: number | null; // posActual - aggregatorGross (null if not comparable)
  /** Sesi AE-56 — untuk channel cash: setoran bank verified di range.
   * Untuk channel lain: 0. */
  bankSettled: number;
  /** Sesi AE-56 — selisih cash spesifik (POS Actual cash - Kasir Lapor cash).
   * Null untuk non-cash. */
  varianceCashPosVsReported: number | null;
  /** Sesi AE-56 — selisih cash spesifik (Kasir Lapor cash - Setoran Bank).
   * Null untuk non-cash. */
  varianceCashReportedVsBank: number | null;
  /** Sesi AE-56 — workflow status default 'open' kalau belum ada note. */
  status: ReconciliationStatus;
  /** Sesi AE-56 — note resolusi (latest, kalau ada multi-day di range pakai
   * aggregate: kosong kalau range > 1 hari). */
  note: string | null;
};

export type SettlementReconciliationReport = {
  rangeFrom: string;
  rangeTo: string;
  rows: SettlementReconciliationRow[];
  /** Sesi AE-56 — header stats untuk tampil di Rekonsiliasi tab. */
  totals: {
    totalReceived: number; // sum posActual semua channel
    totalVariance: number; // sum |variance| semua channel (POS vs Aggregator + cash specifics)
    accuracyPct: number; // 1 - totalVariance/totalReceived (max 100%)
  };
  /** Sesi AE-56 — list anomali yang terdeteksi. */
  anomalies: ReconciliationAnomaly[];
};

// ---------- Reconciliation Drill-down (Sesi AE-56) ----------

export type ReconciliationDrillDownTrx = {
  transactionId: string;
  transactionNumber: string;
  closedAt: string; // ISO
  cashierName: string | null;
  total: number;
  refundedAmount: number;
  netTotal: number;
  paymentMethod: string;
  status: string;
};

export type ReconciliationDrillDownShift = {
  shiftId: string;
  shiftDate: string; // WIB YYYY-MM-DD
  cashierName: string;
  reportedAmount: number;
};

export type ReconciliationDrillDownDeposit = {
  depositId: string;
  depositDate: string;
  amount: number;
  bankDestination: string;
  status: CashDepositStatus;
};

export type ReconciliationDrillDownAggregator = {
  settlementId: string;
  periodFrom: string;
  periodTo: string;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  referenceNo: string | null;
  notes: string | null;
};

export type ReconciliationDrillDown = {
  channel: AggregatorChannel;
  rangeFrom: string;
  rangeTo: string;
  transactions: ReconciliationDrillDownTrx[];
  shiftReports: ReconciliationDrillDownShift[];
  aggregators: ReconciliationDrillDownAggregator[];
  /** Cash only — kalau channel != cash, empty. */
  deposits: ReconciliationDrillDownDeposit[];
  totals: {
    transactionsSum: number;
    shiftReportsSum: number;
    aggregatorsGross: number;
    depositsSum: number;
  };
  /** Sesi AE-56 — true kalau hasil dipotong (>500 row per kategori). */
  truncated: boolean;
};

export type SetReconciliationStatusInput = {
  channel: AggregatorChannel;
  periodDate: string; // YYYY-MM-DD WIB
  status: ReconciliationStatus;
  note?: string | null;
};
