/**
 * Pure finance math helpers — no DB, no I/O. Used both by `queries.ts` and
 * `tests/unit/finance-pure.test.ts` for deterministic unit testing.
 *
 * Keep this module side-effect free. Anything that touches Drizzle or
 * server-only modules belongs in `queries.ts`.
 */

export type ShiftCashSummary = {
  shiftId: string;
  status: "open" | "closed";
  openingCash: number;
  /** Sum cash transactions paid in shift (cash + split-cash legs). */
  cashSales: number;
  /** Cash legs of refunds. */
  refundedCash: number;
};

export type CashOnHandInputs = {
  shifts: ShiftCashSummary[];
  /** Sum of expenses paymentMethod='cash' in window. */
  cashExpenses: number;
  /** Sum of verified cash deposits in window. */
  verifiedDeposits: number;
};

export type CashOnHandResult = {
  closedShiftsContribution: number;
  openShiftDrawerCash: number;
  cashOnHand: number;
};

/**
 * Closed shifts contribute to cash-on-hand: openingCash + cashSales − cashExpenses
 * − refundedCash. Open-shift cash stays in drawer (excluded from cash-on-hand
 * but reported separately for awareness).
 */
export function computeCashOnHand(input: CashOnHandInputs): CashOnHandResult {
  let closedOpening = 0;
  let closedCashSales = 0;
  let closedRefunds = 0;
  let openOpening = 0;
  let openCashSales = 0;
  let openRefunds = 0;

  for (const s of input.shifts) {
    if (s.status === "closed") {
      closedOpening += s.openingCash;
      closedCashSales += s.cashSales;
      closedRefunds += s.refundedCash;
    } else {
      openOpening += s.openingCash;
      openCashSales += s.cashSales;
      openRefunds += s.refundedCash;
    }
  }

  const closedShiftsContribution =
    closedOpening + closedCashSales - input.cashExpenses - closedRefunds;
  const openShiftDrawerCash = openOpening + openCashSales - openRefunds;
  const cashOnHand = closedShiftsContribution - input.verifiedDeposits;

  return { closedShiftsContribution, openShiftDrawerCash, cashOnHand };
}

// ---------------------------------------------------------------------------
// Daily settlement variance helpers
// ---------------------------------------------------------------------------

export type ShiftReportedSettlement = {
  edcSettlement: number | null;
  gofoodSettlement: number | null;
  grabfoodSettlement: number | null;
  shopeefoodSettlement: number | null;
};

export type ShiftActualPayments = {
  cardBcaActual: number;
  qrisActual: number;
};

/**
 * EDC variance = reported − actual. Null when no field reported (kasir skipped).
 */
export function computeEdcVariance(
  reported: ShiftReportedSettlement,
  actual: ShiftActualPayments,
): number | null {
  if (reported.edcSettlement === null) return null;
  return reported.edcSettlement - actual.cardBcaActual;
}

/**
 * Cash variance for a single shift (kasir-counted vs computed expected).
 *   expected = openingCash + cashSales − cashExpenses − refundedCash
 *   variance = actualCash − expected
 *
 * Returns null if shift is open (no actualCash counted yet).
 */
export function computeShiftCashVariance(input: {
  status: "open" | "closed";
  openingCash: number;
  cashSales: number;
  cashExpenses: number;
  refundedCash: number;
  actualCash: number | null;
}): { expected: number; variance: number | null } {
  const expected =
    input.openingCash +
    input.cashSales -
    input.cashExpenses -
    input.refundedCash;
  const variance =
    input.status === "closed" && input.actualCash !== null
      ? input.actualCash - expected
      : null;
  return { expected, variance };
}

// ---------------------------------------------------------------------------
// Payroll → expense math
// ---------------------------------------------------------------------------

/**
 * Pure helper for `markPayrollPaid` — sums `netPay` across payroll lines.
 * Used by tests; production code calls SQL SUM directly for perf.
 */
export function sumPayrollNetPay(
  lines: Array<{ netPay: number }>,
): number {
  return lines.reduce((s, l) => s + l.netPay, 0);
}
