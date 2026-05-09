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

export type AggregatorChannel =
  | "edc_bca"
  | "gofood"
  | "grabfood"
  | "shopeefood"
  | "qris";

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

export type VerifyCashDepositInput = { id: string };
export type RejectCashDepositInput = { id: string; reason: string };

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
  /** Sum of openingCash + cashSales − cashExpenses − refundedCash for closed shifts in [unsettledFromDate, today]. */
  unsettledClosedShiftsCash: number;
  /** Sum of pending deposits in window (informational). */
  pendingDepositsAmount: number;
  /** Sum of verified deposits in window (already subtracted from balance). */
  verifiedDepositsAmount: number;
  /** Open shift drawer cash (excluded from balance). */
  openShiftDrawerCash: number;
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
};

// ---------- Reconciliation ----------

export type SettlementReconciliationRow = {
  channel: AggregatorChannel;
  reportedFromShifts: number; // sum from shifts.{channel}Settlement (kasir-reported)
  posActual: number; // sum from transactions for matchable channels (card_bca/qris)
  aggregatorGross: number; // sum from aggregator_settlements.grossAmount
  aggregatorFee: number;
  aggregatorNet: number;
  varianceShiftsVsAggregator: number; // reportedFromShifts - aggregatorGross
  variancePosVsAggregator: number | null; // posActual - aggregatorGross (null if not comparable)
};

export type SettlementReconciliationReport = {
  rangeFrom: string;
  rangeTo: string;
  rows: SettlementReconciliationRow[];
};
