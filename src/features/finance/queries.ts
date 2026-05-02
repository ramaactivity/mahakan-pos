import "server-only";

import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  aggregatorSettlements,
  cashDeposits,
  expenses,
  incomes,
  purchases,
  shifts,
  splitPayments,
  transactions,
  users,
} from "@/db/schema";
import { JAKARTA_TZ, toJakartaDateOnly } from "@/lib/date";
import type {
  AggregatorChannel,
  CashDeposit,
  CashDepositStatus,
  CashFlowEntry,
  CashFlowEntryKind,
  CashFlowLedgerReport,
  CashOnHandSnapshot,
  DailySettlementReport,
  SettlementReconciliationReport,
  SettlementReconciliationRow,
  ShiftSettlementRow,
} from "./types";

/**
 * Convert a Jakarta calendar date (YYYY-MM-DD) into a UTC `[from, toExclusive)`
 * window covering the entire WIB day. Use for filtering rows by `createdAt`/
 * `closedAt` timestamps in queries.
 */
function jakartaDayBounds(dateIso: string): { from: Date; to: Date } {
  // WIB is UTC+7 with no DST → midnight WIB = previous-day 17:00 UTC.
  const from = new Date(`${dateIso}T00:00:00+07:00`);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { from, to };
}

function jakartaRangeBounds(fromIso: string, toIso: string): {
  from: Date;
  to: Date;
} {
  const from = new Date(`${fromIso}T00:00:00+07:00`);
  const to = new Date(
    new Date(`${toIso}T00:00:00+07:00`).getTime() + 24 * 60 * 60 * 1000,
  );
  return { from, to };
}

// ---------------------------------------------------------------------------
// Q1 — Daily Settlement Report
// ---------------------------------------------------------------------------

/**
 * Daily settlement report for a single Jakarta calendar day. Compares kasir-
 * reported channel settlements (entered at shift close) against actual POS
 * activity from `transactions` + `splitPayments`. Variance surfaces drift
 * between what kasir wrote down vs what the system saw.
 */
export async function getDailySettlementReport(
  outletId: string,
  dateIso: string,
): Promise<DailySettlementReport> {
  const { from, to } = jakartaDayBounds(dateIso);

  // 1. All shifts that opened OR closed during this WIB day.
  const dayShifts = await db
    .select({
      shift: shifts,
      cashier: { id: users.id, name: users.name },
    })
    .from(shifts)
    .leftJoin(users, eq(shifts.userId, users.id))
    .where(
      and(
        eq(shifts.outletId, outletId),
        sql`(${shifts.openedAt} < ${to} AND
              (${shifts.closedAt} IS NULL OR ${shifts.closedAt} >= ${from}))`,
      ),
    )
    .orderBy(asc(shifts.openedAt));

  if (dayShifts.length === 0) {
    return {
      date: dateIso,
      shifts: [],
      totals: emptyTotals(),
    };
  }

  const shiftIds = dayShifts.map((s) => s.shift.id);

  // 2. Per-shift transaction aggregations.
  const trxAggRows = await db
    .select({
      shiftId: transactions.shiftId,
      paymentMethod: transactions.paymentMethod,
      status: transactions.status,
      total: sql<string>`COALESCE(SUM(${transactions.total}), 0)`,
      count: sql<string>`COUNT(*)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.outletId, outletId),
        inArray(transactions.shiftId, shiftIds),
      ),
    )
    .groupBy(transactions.shiftId, transactions.paymentMethod, transactions.status);

  // 3. Split-payment legs per shift (only for status='paid' parent trx).
  const splitAggRows = await db
    .select({
      shiftId: splitPayments.shiftId,
      paymentMethod: splitPayments.paymentMethod,
      total: sql<string>`COALESCE(SUM(${splitPayments.amount}), 0)`,
    })
    .from(splitPayments)
    .innerJoin(transactions, eq(splitPayments.transactionId, transactions.id))
    .where(
      and(
        inArray(splitPayments.shiftId, shiftIds),
        eq(transactions.status, "paid"),
      ),
    )
    .groupBy(splitPayments.shiftId, splitPayments.paymentMethod);

  // 4. Per-shift cash expenses (POS petty cash this shift period).
  // Approximation: filter expenses by outlet + expense_date == dateIso AND
  // paymentMethod='cash'. Multi-shift days share the bucket — split is
  // proportional to # shifts. Acceptable for finance overview.
  const cashExpRows = await db
    .select({
      total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)`,
      count: sql<string>`COUNT(*)`,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.outletId, outletId),
        eq(expenses.expenseDate, dateIso),
        eq(expenses.paymentMethod, "cash"),
        isNull(expenses.deletedAt),
      ),
    );
  const totalCashExpensesDay = Number(cashExpRows[0]?.total ?? 0);

  // 5. Build per-shift rows.
  const rows: ShiftSettlementRow[] = dayShifts.map(({ shift, cashier }) => {
    const matchTrx = (status: string, method: string) =>
      Number(
        trxAggRows.find(
          (r) =>
            r.shiftId === shift.id &&
            r.status === status &&
            r.paymentMethod === method,
        )?.total ?? 0,
      );

    const matchSplit = (method: string) =>
      Number(
        splitAggRows.find(
          (r) => r.shiftId === shift.id && r.paymentMethod === method,
        )?.total ?? 0,
      );

    const cashSales = matchTrx("paid", "cash") + matchSplit("cash");
    const cardBcaActual = matchTrx("paid", "card_bca") + matchSplit("card_bca");
    const qrisActual = matchTrx("paid", "qris") + matchSplit("qris");
    const refundedCash = matchTrx("refunded", "cash");

    // Allocate day's cash expenses evenly across shifts (informational).
    const cashExpenses =
      dayShifts.length > 0
        ? Math.round(totalCashExpensesDay / dayShifts.length)
        : 0;

    const expectedCash =
      shift.openingCash + cashSales - cashExpenses - refundedCash;

    const cashVariance =
      shift.actualCash !== null && shift.actualCash !== undefined
        ? shift.actualCash - expectedCash
        : null;

    const edcVariance =
      shift.edcSettlement !== null && shift.edcSettlement !== undefined
        ? shift.edcSettlement - cardBcaActual
        : null;

    return {
      shiftId: shift.id,
      cashierId: shift.userId,
      cashierName: cashier?.name ?? "-",
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      openingCash: shift.openingCash,
      actualCash: shift.actualCash ?? null,
      expectedCash: shift.status === "closed" ? expectedCash : null,
      cashVariance,
      cashSales,
      cashExpenses,
      cardBcaActual,
      qrisActual,
      refundedCash,
      edcReported: shift.edcSettlement ?? null,
      gofoodReported: shift.gofoodSettlement ?? null,
      grabfoodReported: shift.grabfoodSettlement ?? null,
      shopeefoodReported: shift.shopeefoodSettlement ?? null,
      edcVariance,
    };
  });

  // 6. Totals.
  const totals = {
    openingCash: rows.reduce((s, r) => s + r.openingCash, 0),
    cashSales: rows.reduce((s, r) => s + r.cashSales, 0),
    cashExpenses: totalCashExpensesDay,
    refundedCash: rows.reduce((s, r) => s + r.refundedCash, 0),
    actualCashCounted: rows.reduce((s, r) => s + (r.actualCash ?? 0), 0),
    expectedCash: rows.reduce((s, r) => s + (r.expectedCash ?? 0), 0),
    cashVariance: rows.reduce((s, r) => s + (r.cashVariance ?? 0), 0),
    cardBcaActual: rows.reduce((s, r) => s + r.cardBcaActual, 0),
    qrisActual: rows.reduce((s, r) => s + r.qrisActual, 0),
    edcReported: rows.reduce((s, r) => s + (r.edcReported ?? 0), 0),
    gofoodReported: rows.reduce((s, r) => s + (r.gofoodReported ?? 0), 0),
    grabfoodReported: rows.reduce((s, r) => s + (r.grabfoodReported ?? 0), 0),
    shopeefoodReported: rows.reduce(
      (s, r) => s + (r.shopeefoodReported ?? 0),
      0,
    ),
    edcVariance: rows.reduce((s, r) => s + (r.edcVariance ?? 0), 0),
    transactionCount: trxAggRows.reduce((s, r) => s + Number(r.count), 0),
    paidCount: trxAggRows
      .filter((r) => r.status === "paid")
      .reduce((s, r) => s + Number(r.count), 0),
    voidedCount: trxAggRows
      .filter((r) => r.status === "voided")
      .reduce((s, r) => s + Number(r.count), 0),
    refundedCount: trxAggRows
      .filter((r) => r.status === "refunded")
      .reduce((s, r) => s + Number(r.count), 0),
  };

  return { date: dateIso, shifts: rows, totals };
}

function emptyTotals(): DailySettlementReport["totals"] {
  return {
    openingCash: 0,
    cashSales: 0,
    cashExpenses: 0,
    refundedCash: 0,
    actualCashCounted: 0,
    expectedCash: 0,
    cashVariance: 0,
    cardBcaActual: 0,
    qrisActual: 0,
    edcReported: 0,
    gofoodReported: 0,
    grabfoodReported: 0,
    shopeefoodReported: 0,
    edcVariance: 0,
    transactionCount: 0,
    paidCount: 0,
    voidedCount: 0,
    refundedCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Q2 — Cash on Hand + Cash Deposits
// ---------------------------------------------------------------------------

/**
 * Compute current cash-on-hand for an outlet, derived on-the-fly:
 *
 * cashOnHand =
 *   Σ(closed shifts since lastVerifiedDeposit.coversToDate+1)
 *     openingCash + cashSales − cashExpenses(cash) − refundedCash
 *   − Σ(verified deposits in same window)
 *
 * Open shifts are excluded (cash still in active drawer, not handed over).
 * Pending deposits do NOT subtract from cash-on-hand (they're informational
 * until verified by Owner).
 */
export async function getCashOnHand(
  outletId: string,
): Promise<CashOnHandSnapshot> {
  const today = toJakartaDateOnly(new Date());

  // 1. Find latest verified deposit's coversToDate.
  const [lastVerified] = await db
    .select({ coversToDate: cashDeposits.coversToDate })
    .from(cashDeposits)
    .where(
      and(
        eq(cashDeposits.outletId, outletId),
        eq(cashDeposits.status, "verified"),
      ),
    )
    .orderBy(desc(cashDeposits.coversToDate), desc(cashDeposits.verifiedAt))
    .limit(1);

  const unsettledFromDate = lastVerified
    ? addOneDayIso(lastVerified.coversToDate)
    : null;

  // Window: [unsettledFromDate or first-ever, today] in WIB.
  // For closed shifts, filter by closedAt timestamp window.
  const windowFrom = unsettledFromDate
    ? new Date(`${unsettledFromDate}T00:00:00+07:00`)
    : new Date("1970-01-01T00:00:00+07:00");
  const windowTo = new Date(`${today}T23:59:59.999+07:00`);

  // 2. Sum across closed shifts in window.
  const closedShifts = await db
    .select({
      id: shifts.id,
      openingCash: shifts.openingCash,
    })
    .from(shifts)
    .where(
      and(
        eq(shifts.outletId, outletId),
        eq(shifts.status, "closed"),
        gte(shifts.closedAt, windowFrom),
        lte(shifts.closedAt, windowTo),
      ),
    );

  const closedShiftIds = closedShifts.map((s) => s.id);
  const totalOpeningCash = closedShifts.reduce((s, r) => s + r.openingCash, 0);

  let cashSales = 0;
  let refundedCash = 0;

  if (closedShiftIds.length > 0) {
    const trxAgg = await db
      .select({
        paymentMethod: transactions.paymentMethod,
        status: transactions.status,
        total: sql<string>`COALESCE(SUM(${transactions.total}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.outletId, outletId),
          inArray(transactions.shiftId, closedShiftIds),
        ),
      )
      .groupBy(transactions.paymentMethod, transactions.status);

    for (const row of trxAgg) {
      const amt = Number(row.total);
      if (row.status === "paid" && row.paymentMethod === "cash") {
        cashSales += amt;
      } else if (row.status === "refunded" && row.paymentMethod === "cash") {
        refundedCash += amt;
      }
    }

    const splitAgg = await db
      .select({
        total: sql<string>`COALESCE(SUM(${splitPayments.amount}), 0)`,
      })
      .from(splitPayments)
      .innerJoin(transactions, eq(splitPayments.transactionId, transactions.id))
      .where(
        and(
          eq(splitPayments.paymentMethod, "cash"),
          eq(transactions.status, "paid"),
          inArray(splitPayments.shiftId, closedShiftIds),
        ),
      );
    cashSales += Number(splitAgg[0]?.total ?? 0);
  }

  // 3. Cash expenses in window (by expense_date, paymentMethod=cash).
  const cashExpRows = await db
    .select({
      total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)`,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.outletId, outletId),
        eq(expenses.paymentMethod, "cash"),
        isNull(expenses.deletedAt),
        gte(expenses.expenseDate, unsettledFromDate ?? "1970-01-01"),
        lte(expenses.expenseDate, today),
      ),
    );
  const cashExpensesTotal = Number(cashExpRows[0]?.total ?? 0);

  // 4. Verified deposits in window.
  const depAgg = await db
    .select({
      verified: sql<string>`COALESCE(SUM(CASE WHEN ${cashDeposits.status} = 'verified' THEN ${cashDeposits.amount} ELSE 0 END), 0)`,
      pending: sql<string>`COALESCE(SUM(CASE WHEN ${cashDeposits.status} = 'pending_verification' THEN ${cashDeposits.amount} ELSE 0 END), 0)`,
      pendingCount: sql<string>`COUNT(*) FILTER (WHERE ${cashDeposits.status} = 'pending_verification')`,
    })
    .from(cashDeposits)
    .where(
      and(
        eq(cashDeposits.outletId, outletId),
        gte(
          cashDeposits.coversFromDate,
          unsettledFromDate ?? "1970-01-01",
        ),
        lte(cashDeposits.coversToDate, today),
      ),
    );
  const verifiedDepositsAmount = Number(depAgg[0]?.verified ?? 0);
  const pendingDepositsAmount = Number(depAgg[0]?.pending ?? 0);
  const pendingDepositCount = Number(depAgg[0]?.pendingCount ?? 0);

  // 5. Open shift drawer cash (excluded from cash-on-hand, informational).
  let openShiftDrawerCash = 0;
  const openShifts = await db
    .select({ id: shifts.id, openingCash: shifts.openingCash })
    .from(shifts)
    .where(
      and(
        eq(shifts.outletId, outletId),
        eq(shifts.status, "open"),
      ),
    );
  if (openShifts.length > 0) {
    const openIds = openShifts.map((s) => s.id);
    openShiftDrawerCash = openShifts.reduce((s, r) => s + r.openingCash, 0);
    const trxAgg = await db
      .select({
        paymentMethod: transactions.paymentMethod,
        status: transactions.status,
        total: sql<string>`COALESCE(SUM(${transactions.total}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.outletId, outletId),
          inArray(transactions.shiftId, openIds),
        ),
      )
      .groupBy(transactions.paymentMethod, transactions.status);
    for (const row of trxAgg) {
      if (row.status === "paid" && row.paymentMethod === "cash") {
        openShiftDrawerCash += Number(row.total);
      } else if (row.status === "refunded" && row.paymentMethod === "cash") {
        openShiftDrawerCash -= Number(row.total);
      }
    }
  }

  const unsettledClosedShiftsCash =
    totalOpeningCash + cashSales - cashExpensesTotal - refundedCash;
  const cashOnHand = unsettledClosedShiftsCash - verifiedDepositsAmount;

  // Threshold: from outlet settings or fallback default.
  const [outletRow] = await db
    .select({ settings: sql<Record<string, unknown>>`settings` })
    .from(sql`outlets`)
    .where(sql`id = ${outletId}`)
    .limit(1);
  const settings = (outletRow?.settings ?? {}) as {
    finance?: { cashOnHandThreshold?: number };
  };
  const thresholdIdr = settings?.finance?.cashOnHandThreshold ?? 5_000_000;

  return {
    outletId,
    asOf: new Date(),
    unsettledFromDate,
    unsettledClosedShiftsCash,
    pendingDepositsAmount,
    verifiedDepositsAmount,
    openShiftDrawerCash,
    cashOnHand,
    thresholdIdr,
    isOverThreshold: cashOnHand > thresholdIdr,
    pendingDepositCount,
  };
}

function addOneDayIso(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function listCashDeposits(opts: {
  outletId: string;
  status?: CashDepositStatus | "all";
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  rows: Array<
    CashDeposit & {
      depositorName: string | null;
      verifierName: string | null;
    }
  >;
  total: number;
}> {
  const { outletId, status, fromDate, toDate, limit = 50, offset = 0 } = opts;
  const conds = [eq(cashDeposits.outletId, outletId)];
  if (status && status !== "all") {
    conds.push(eq(cashDeposits.status, status));
  }
  if (fromDate) {
    conds.push(gte(cashDeposits.depositDate, fromDate));
  }
  if (toDate) {
    conds.push(lte(cashDeposits.depositDate, toDate));
  }

  const depositorAlias = users;
  const rows = await db
    .select({
      deposit: cashDeposits,
      depositorName: depositorAlias.name,
    })
    .from(cashDeposits)
    .leftJoin(depositorAlias, eq(cashDeposits.depositedBy, depositorAlias.id))
    .where(and(...conds))
    .orderBy(desc(cashDeposits.depositDate), desc(cashDeposits.createdAt))
    .limit(limit)
    .offset(offset);

  // Hydrate verifier names separately to avoid double-aliasing complexity.
  const verifierIds = Array.from(
    new Set(
      rows
        .map((r) => r.deposit.verifiedBy)
        .filter((v): v is string => Boolean(v)),
    ),
  );
  const verifierMap = new Map<string, string>();
  if (verifierIds.length > 0) {
    const vRows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, verifierIds));
    for (const v of vRows) verifierMap.set(v.id, v.name);
  }

  const totalRow = await db
    .select({ count: sql<string>`COUNT(*)` })
    .from(cashDeposits)
    .where(and(...conds));
  const total = Number(totalRow[0]?.count ?? 0);

  return {
    rows: rows.map((r) => ({
      ...r.deposit,
      depositorName: r.depositorName ?? null,
      verifierName: r.deposit.verifiedBy
        ? verifierMap.get(r.deposit.verifiedBy) ?? null
        : null,
    })),
    total,
  };
}

// ---------------------------------------------------------------------------
// Q3 — Cash Flow Ledger + Settlement Reconciliation
// ---------------------------------------------------------------------------

export async function getCashFlowLedger(
  outletId: string,
  fromIso: string,
  toIso: string,
): Promise<CashFlowLedgerReport> {
  // Pull expenses + incomes + verified deposits, merge by date.
  const expRows = await db
    .select({
      id: expenses.id,
      date: expenses.expenseDate,
      sourceType: expenses.sourceType,
      description: expenses.description,
      paymentMethod: expenses.paymentMethod,
      amount: expenses.amount,
      payrollPeriodId: expenses.payrollPeriodId,
      purchaseId: expenses.purchaseId,
      refundedTransactionId: expenses.refundedTransactionId,
      createdBy: expenses.createdBy,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.outletId, outletId),
        gte(expenses.expenseDate, fromIso),
        lte(expenses.expenseDate, toIso),
        isNull(expenses.deletedAt),
      ),
    )
    .orderBy(asc(expenses.expenseDate));

  const incRows = await db
    .select({
      id: incomes.id,
      date: incomes.incomeDate,
      description: incomes.description,
      paymentMethod: incomes.paymentMethod,
      amount: incomes.amount,
      createdBy: incomes.createdBy,
    })
    .from(incomes)
    .where(
      and(
        eq(incomes.outletId, outletId),
        gte(incomes.incomeDate, fromIso),
        lte(incomes.incomeDate, toIso),
        isNull(incomes.deletedAt),
      ),
    )
    .orderBy(asc(incomes.incomeDate));

  const depRows = await db
    .select({
      id: cashDeposits.id,
      date: cashDeposits.depositDate,
      bankDestination: cashDeposits.bankDestination,
      amount: cashDeposits.amount,
      depositedBy: cashDeposits.depositedBy,
    })
    .from(cashDeposits)
    .where(
      and(
        eq(cashDeposits.outletId, outletId),
        eq(cashDeposits.status, "verified"),
        gte(cashDeposits.depositDate, fromIso),
        lte(cashDeposits.depositDate, toIso),
      ),
    )
    .orderBy(asc(cashDeposits.depositDate));

  const entries: CashFlowEntry[] = [];

  for (const e of expRows) {
    const kind: CashFlowEntryKind =
      e.sourceType === "purchase"
        ? "expense_purchase"
        : e.sourceType === "payroll"
          ? "expense_payroll"
          : e.sourceType === "refund"
            ? "expense_refund"
            : "expense_manual";
    entries.push({
      id: e.id,
      date: e.date,
      kind,
      description: e.description,
      paymentMethod: e.paymentMethod,
      amount: -e.amount,
      referenceId:
        e.purchaseId ?? e.payrollPeriodId ?? e.refundedTransactionId ?? null,
      createdBy: e.createdBy,
    });
  }

  for (const i of incRows) {
    entries.push({
      id: i.id,
      date: i.date,
      kind: "income_manual",
      description: i.description,
      paymentMethod: i.paymentMethod,
      amount: i.amount,
      referenceId: null,
      createdBy: i.createdBy,
    });
  }

  for (const d of depRows) {
    entries.push({
      id: d.id,
      date: d.date,
      kind: "deposit_verified",
      description: `Setoran tunai ke ${d.bankDestination}`,
      paymentMethod: "cash",
      amount: -d.amount,
      referenceId: null,
      createdBy: d.depositedBy,
    });
  }

  entries.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.id.localeCompare(b.id);
  });

  const byKind: Record<CashFlowEntryKind, number> = {
    expense_manual: 0,
    expense_purchase: 0,
    expense_payroll: 0,
    expense_refund: 0,
    income_manual: 0,
    deposit_verified: 0,
  };
  let inflow = 0;
  let outflow = 0;
  for (const e of entries) {
    byKind[e.kind] += e.amount;
    if (e.amount > 0) inflow += e.amount;
    else outflow += -e.amount;
  }

  return {
    rangeFrom: fromIso,
    rangeTo: toIso,
    entries,
    totals: {
      inflowTotal: inflow,
      outflowTotal: outflow,
      netFlow: inflow - outflow,
      byKind,
    },
  };
}

export async function getSettlementReconciliation(
  outletId: string,
  fromIso: string,
  toIso: string,
): Promise<SettlementReconciliationReport> {
  const channels: AggregatorChannel[] = [
    "edc_bca",
    "gofood",
    "grabfood",
    "shopeefood",
    "qris",
  ];

  // Sum kasir-reported settlement fields from shifts that closed in window.
  const { from, to } = jakartaRangeBounds(fromIso, toIso);
  const shiftAgg = await db
    .select({
      edc: sql<string>`COALESCE(SUM(${shifts.edcSettlement}), 0)`,
      gofood: sql<string>`COALESCE(SUM(${shifts.gofoodSettlement}), 0)`,
      grabfood: sql<string>`COALESCE(SUM(${shifts.grabfoodSettlement}), 0)`,
      shopeefood: sql<string>`COALESCE(SUM(${shifts.shopeefoodSettlement}), 0)`,
    })
    .from(shifts)
    .where(
      and(
        eq(shifts.outletId, outletId),
        eq(shifts.status, "closed"),
        gte(shifts.closedAt, from),
        lte(shifts.closedAt, to),
      ),
    );
  const reportedByChannel: Record<AggregatorChannel, number> = {
    edc_bca: Number(shiftAgg[0]?.edc ?? 0),
    gofood: Number(shiftAgg[0]?.gofood ?? 0),
    grabfood: Number(shiftAgg[0]?.grabfood ?? 0),
    shopeefood: Number(shiftAgg[0]?.shopeefood ?? 0),
    qris: 0, // no kasir-reported field for qris
  };

  // POS actual (only matchable for card_bca and qris).
  const trxAgg = await db
    .select({
      paymentMethod: transactions.paymentMethod,
      total: sql<string>`COALESCE(SUM(${transactions.total}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.outletId, outletId),
        eq(transactions.status, "paid"),
        gte(transactions.createdAt, from),
        lte(transactions.createdAt, to),
      ),
    )
    .groupBy(transactions.paymentMethod);

  const splitAgg = await db
    .select({
      paymentMethod: splitPayments.paymentMethod,
      total: sql<string>`COALESCE(SUM(${splitPayments.amount}), 0)`,
    })
    .from(splitPayments)
    .innerJoin(transactions, eq(splitPayments.transactionId, transactions.id))
    .where(
      and(
        eq(transactions.outletId, outletId),
        eq(transactions.status, "paid"),
        gte(transactions.createdAt, from),
        lte(transactions.createdAt, to),
      ),
    )
    .groupBy(splitPayments.paymentMethod);

  const cardBcaActual =
    Number(
      trxAgg.find((r) => r.paymentMethod === "card_bca")?.total ?? 0,
    ) +
    Number(
      splitAgg.find((r) => r.paymentMethod === "card_bca")?.total ?? 0,
    );
  const qrisActual =
    Number(trxAgg.find((r) => r.paymentMethod === "qris")?.total ?? 0) +
    Number(splitAgg.find((r) => r.paymentMethod === "qris")?.total ?? 0);

  const posActualByChannel: Record<AggregatorChannel, number | null> = {
    edc_bca: cardBcaActual,
    qris: qrisActual,
    gofood: null,
    grabfood: null,
    shopeefood: null,
  };

  // Aggregator settlements per channel.
  const aggRows = await db
    .select({
      channel: aggregatorSettlements.channel,
      gross: sql<string>`COALESCE(SUM(${aggregatorSettlements.grossAmount}), 0)`,
      fee: sql<string>`COALESCE(SUM(${aggregatorSettlements.feeAmount}), 0)`,
      net: sql<string>`COALESCE(SUM(${aggregatorSettlements.netAmount}), 0)`,
    })
    .from(aggregatorSettlements)
    .where(
      and(
        eq(aggregatorSettlements.outletId, outletId),
        gte(aggregatorSettlements.periodFrom, fromIso),
        lte(aggregatorSettlements.periodTo, toIso),
      ),
    )
    .groupBy(aggregatorSettlements.channel);

  const rows: SettlementReconciliationRow[] = channels.map((ch) => {
    const agg = aggRows.find((r) => r.channel === ch);
    const aggGross = Number(agg?.gross ?? 0);
    const aggFee = Number(agg?.fee ?? 0);
    const aggNet = Number(agg?.net ?? 0);
    const reported = reportedByChannel[ch];
    const posActual = posActualByChannel[ch];

    return {
      channel: ch,
      reportedFromShifts: reported,
      posActual: posActual ?? 0,
      aggregatorGross: aggGross,
      aggregatorFee: aggFee,
      aggregatorNet: aggNet,
      varianceShiftsVsAggregator: reported - aggGross,
      variancePosVsAggregator: posActual !== null ? posActual - aggGross : null,
    };
  });

  return { rangeFrom: fromIso, rangeTo: toIso, rows };
}

export async function listAggregatorSettlements(opts: {
  outletId: string;
  channel?: AggregatorChannel | "all";
  fromDate?: string;
  toDate?: string;
}): Promise<
  Array<
    {
      id: string;
      channel: AggregatorChannel;
      periodFrom: string;
      periodTo: string;
      grossAmount: number;
      feeAmount: number;
      netAmount: number;
      bankCreditedAt: Date | null;
      referenceNo: string | null;
      notes: string | null;
      createdAt: Date;
      createdByName: string | null;
    }
  >
> {
  const conds = [eq(aggregatorSettlements.outletId, opts.outletId)];
  if (opts.channel && opts.channel !== "all") {
    conds.push(eq(aggregatorSettlements.channel, opts.channel));
  }
  if (opts.fromDate) {
    conds.push(gte(aggregatorSettlements.periodFrom, opts.fromDate));
  }
  if (opts.toDate) {
    conds.push(lte(aggregatorSettlements.periodTo, opts.toDate));
  }

  const rows = await db
    .select({
      row: aggregatorSettlements,
      creatorName: users.name,
    })
    .from(aggregatorSettlements)
    .leftJoin(users, eq(aggregatorSettlements.createdBy, users.id))
    .where(and(...conds))
    .orderBy(
      desc(aggregatorSettlements.periodFrom),
      desc(aggregatorSettlements.createdAt),
    );

  return rows.map((r) => ({
    id: r.row.id,
    channel: r.row.channel as AggregatorChannel,
    periodFrom: r.row.periodFrom,
    periodTo: r.row.periodTo,
    grossAmount: r.row.grossAmount,
    feeAmount: r.row.feeAmount,
    netAmount: r.row.netAmount,
    bankCreditedAt: r.row.bankCreditedAt,
    referenceNo: r.row.referenceNo,
    notes: r.row.notes,
    createdAt: r.row.createdAt,
    createdByName: r.creatorName ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Hutang Dagang surfacing — reuse purchases query path.
// ---------------------------------------------------------------------------

export async function listOutstandingTopForFinance(outletId: string): Promise<
  Array<{
    id: string;
    purchaseDate: string;
    dueDate: string | null;
    totalAmount: number;
    supplierName: string | null;
    invoiceNo: string | null;
    paymentMethod: string;
    status: string;
  }>
> {
  // Inline simple query to avoid pulling whole purchases module surface.
  const rows = await db
    .select({
      id: purchases.id,
      purchaseDate: purchases.purchaseDate,
      dueDate: purchases.dueDate,
      totalAmount: purchases.totalAmount,
      invoiceNo: purchases.invoiceNo,
      paymentMethod: purchases.paymentMethod,
      status: purchases.status,
      supplierName:
        sql<string>`COALESCE((SELECT s.name FROM suppliers s WHERE s.id = ${purchases.supplierId}), 'Walk-in')`.as(
          "supplier_name",
        ),
    })
    .from(purchases)
    .where(
      and(
        eq(purchases.outletId, outletId),
        eq(purchases.status, "pending_payment"),
      ),
    )
    .orderBy(asc(purchases.dueDate));

  return rows;
}

export async function getOutletThreshold(outletId: string): Promise<number> {
  const [r] = await db
    .select({ settings: sql<Record<string, unknown>>`settings` })
    .from(sql`outlets`)
    .where(sql`id = ${outletId}`)
    .limit(1);
  const settings = (r?.settings ?? {}) as {
    finance?: { cashOnHandThreshold?: number };
  };
  return settings?.finance?.cashOnHandThreshold ?? 5_000_000;
}

// Re-exports so consumers can `import { ... } from "@/features/finance"`.
export { JAKARTA_TZ };
