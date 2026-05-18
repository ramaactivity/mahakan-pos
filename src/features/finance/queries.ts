import "server-only";

import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  aggregatorSettlements,
  cashDeposits,
  expenses,
  incomes,
  purchases,
  reconciliationNotes,
  shifts,
  splitPayments,
  transactions,
  users,
} from "@/db/schema";
import { JAKARTA_TZ, toJakartaDateOnly } from "@/lib/date";
import type {
  AggregatorChannel,
  CashDailyRollup,
  CashDeposit,
  CashDepositDashboard,
  CashDepositStatus,
  CashFlowEntry,
  CashFlowEntryKind,
  CashFlowLedgerReport,
  CashOnHandSnapshot,
  DailySettlementReport,
  ReconciliationDrillDown,
  ReconciliationStatus,
  SettlementReconciliationReport,
  SettlementReconciliationRow,
  ShiftSettlementRow,
} from "./types";
import {
  computeReconciliationTotals,
  detectReconciliationAnomalies,
} from "./reconciliation-pure";

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
 *     cashSales − cashExpenses(cash) − refundedCash
 *   − Σ(verified deposits in same window)
 *
 * Open shifts are excluded (cash still in active drawer, not handed over).
 * Pending deposits do NOT subtract from cash-on-hand (they're informational
 * until verified by Owner).
 *
 * Sesi AE-62f — openingCash NOT summed. opening_cash adalah PETTY CASH FLOAT
 * (carryover dari shift sebelumnya, bukan injection baru). Summing openingCash
 * across N shifts double-counts the float N×. Real-world: cashier opens shift
 * with 200k yang sudah ada di laci (sisa shift sebelumnya), bukan deposit baru.
 *
 * Before sesi AE-62f, formula INCLUDED openingCash sum → kasir lihat 3.5jt di
 * "Kas Tersedia" tapi Riwayat Harian (yang ga sum openingCash) cuma 2.3jt →
 * setor 3jt sesuai card → Riwayat jadi -680k minus. Sekarang konsisten.
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

  // 2. Sum across closed shifts in window. Sesi AE-62f — openingCash NOT
  // summed (petty cash float, carryover bukan injection). See doc comment.
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
  // Sesi AE-62f — petty cash float for display only (last shift's opening).
  const pettyCashFloat = closedShifts.length > 0
    ? Math.max(...closedShifts.map((s) => s.openingCash))
    : 0;

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

  // Sesi AE-62f — opening_cash EXCLUDED (petty cash float carryover, bukan
  // new cash injection). Match Riwayat Harian math = sales - exp - dep.
  const unsettledClosedShiftsCash =
    cashSales - cashExpensesTotal - refundedCash;
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
    pettyCashFloat,
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

function subtractDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Sesi AE-8 — Setoran Tunai dashboard aggregate.
 *
 * Mengembalikan single payload yang fuel: 4 stat cards (cash on hand,
 * outstanding, last verified, pending count) + daily rollup table 30
 * hari terakhir (mirror spreadsheet DAILY CASHIER REPORT pattern).
 *
 * Dipakai by SetoranTunaiSection (backoffice) + KasOwnerPanel (POS).
 *
 * Performance note: query ini punya beberapa round-trip ke DB (cash on
 * hand snapshot + 30-day shift sums + 30-day deposit sums). Acceptable
 * untuk dashboard yang refetch jarang via TanStack Query staleTime.
 */
export async function getCashDepositDashboard(
  outletId: string,
): Promise<CashDepositDashboard> {
  const todayIso = toJakartaDateOnly(new Date());
  const fromIso = subtractDaysIso(todayIso, 29); // 30 hari termasuk hari ini

  const onHand = await getCashOnHand(outletId);
  const outstandingToDeposit = Math.max(0, onHand.cashOnHand);

  // Last verified deposit (any date, not just window).
  const [lastVerifiedRow] = await db
    .select({
      id: cashDeposits.id,
      depositDate: cashDeposits.depositDate,
      amount: cashDeposits.amount,
      bankDestination: cashDeposits.bankDestination,
      verifiedAt: cashDeposits.verifiedAt,
      verifierName: users.name,
    })
    .from(cashDeposits)
    .leftJoin(users, eq(cashDeposits.verifiedBy, users.id))
    .where(
      and(
        eq(cashDeposits.outletId, outletId),
        eq(cashDeposits.status, "verified"),
      ),
    )
    .orderBy(desc(cashDeposits.verifiedAt))
    .limit(1);

  const lastVerified = lastVerifiedRow?.verifiedAt
    ? {
        id: lastVerifiedRow.id,
        depositDate: String(lastVerifiedRow.depositDate),
        amount: Number(lastVerifiedRow.amount),
        bankDestination: lastVerifiedRow.bankDestination,
        verifierName: lastVerifiedRow.verifierName,
        verifiedAt: lastVerifiedRow.verifiedAt,
      }
    : null;

  // Pending stats + oldest pending age (sesi AE-10 anti-fraud time gap alert).
  const [pendingAgg] = await db
    .select({
      count: sql<string>`COUNT(*)`,
      total: sql<string>`COALESCE(SUM(${cashDeposits.amount}), 0)`,
      oldestCreatedAt: sql<
        Date | null
      >`MIN(${cashDeposits.createdAt})`,
    })
    .from(cashDeposits)
    .where(
      and(
        eq(cashDeposits.outletId, outletId),
        eq(cashDeposits.status, "pending_verification"),
      ),
    );
  const pendingCount = Number(pendingAgg?.count ?? 0);
  const pendingTotal = Number(pendingAgg?.total ?? 0);
  const oldestPendingDays =
    pendingCount > 0 && pendingAgg?.oldestCreatedAt
      ? Math.floor(
          (Date.now() - new Date(pendingAgg.oldestCreatedAt).getTime()) /
            (24 * 60 * 60 * 1000),
        )
      : null;

  // Total deposited this calendar month (verified only, by depositDate).
  const monthStart = `${todayIso.slice(0, 7)}-01`;
  const [monthAgg] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${cashDeposits.amount}), 0)`,
    })
    .from(cashDeposits)
    .where(
      and(
        eq(cashDeposits.outletId, outletId),
        eq(cashDeposits.status, "verified"),
        gte(cashDeposits.depositDate, monthStart),
        lte(cashDeposits.depositDate, todayIso),
      ),
    );
  const totalDepositedThisMonth = Number(monthAgg?.total ?? 0);

  // 30-day daily rollup. Pull aggregates per day, then iterate dates building
  // running balance from oldest verified-deposit-anchored carryover.
  const windowFrom = new Date(`${fromIso}T00:00:00+07:00`);
  const windowTo = new Date(`${todayIso}T23:59:59.999+07:00`);

  // Group closed shifts per WIB date, sum opening cash.
  const shiftsAgg = await db
    .select({
      shiftId: shifts.id,
      openingCash: shifts.openingCash,
      closedAt: shifts.closedAt,
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

  // Map shift → date string for grouping.
  const shiftToDate = new Map<string, string>();
  const dateShiftSummary = new Map<
    string,
    { openingCash: number; shiftIds: string[] }
  >();
  for (const s of shiftsAgg) {
    if (!s.closedAt) continue;
    const dateIso = toJakartaDateOnly(s.closedAt);
    shiftToDate.set(s.shiftId, dateIso);
    const cur = dateShiftSummary.get(dateIso) ?? {
      openingCash: 0,
      shiftIds: [],
    };
    cur.openingCash += s.openingCash;
    cur.shiftIds.push(s.shiftId);
    dateShiftSummary.set(dateIso, cur);
  }

  // Cash sales + refunded cash per shift, then re-bucket by date.
  const allShiftIds = shiftsAgg.map((s) => s.shiftId);
  const dateCashSales = new Map<string, number>();
  if (allShiftIds.length > 0) {
    const trxRows = await db
      .select({
        shiftId: transactions.shiftId,
        paymentMethod: transactions.paymentMethod,
        status: transactions.status,
        total: sql<string>`COALESCE(SUM(${transactions.total}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.outletId, outletId),
          inArray(transactions.shiftId, allShiftIds),
        ),
      )
      .groupBy(
        transactions.shiftId,
        transactions.paymentMethod,
        transactions.status,
      );

    for (const r of trxRows) {
      const dateIso = shiftToDate.get(r.shiftId ?? "");
      if (!dateIso) continue;
      const amt = Number(r.total);
      if (r.status === "paid" && r.paymentMethod === "cash") {
        dateCashSales.set(dateIso, (dateCashSales.get(dateIso) ?? 0) + amt);
      } else if (r.status === "refunded" && r.paymentMethod === "cash") {
        dateCashSales.set(dateIso, (dateCashSales.get(dateIso) ?? 0) - amt);
      }
    }

    // Split-payment cash legs.
    const splitRows = await db
      .select({
        shiftId: splitPayments.shiftId,
        total: sql<string>`COALESCE(SUM(${splitPayments.amount}), 0)`,
      })
      .from(splitPayments)
      .innerJoin(transactions, eq(splitPayments.transactionId, transactions.id))
      .where(
        and(
          eq(splitPayments.paymentMethod, "cash"),
          eq(transactions.status, "paid"),
          inArray(splitPayments.shiftId, allShiftIds),
        ),
      )
      .groupBy(splitPayments.shiftId);
    for (const r of splitRows) {
      const dateIso = shiftToDate.get(r.shiftId ?? "");
      if (!dateIso) continue;
      dateCashSales.set(
        dateIso,
        (dateCashSales.get(dateIso) ?? 0) + Number(r.total),
      );
    }
  }

  // Cash expenses per expense_date.
  const expenseRows = await db
    .select({
      date: expenses.expenseDate,
      total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)`,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.outletId, outletId),
        eq(expenses.paymentMethod, "cash"),
        isNull(expenses.deletedAt),
        gte(expenses.expenseDate, fromIso),
        lte(expenses.expenseDate, todayIso),
      ),
    )
    .groupBy(expenses.expenseDate);
  const dateExpenses = new Map<string, number>();
  for (const r of expenseRows) {
    dateExpenses.set(String(r.date), Number(r.total));
  }

  // Deposits per deposit_date, split verified vs pending.
  const depositRows = await db
    .select({
      date: cashDeposits.depositDate,
      status: cashDeposits.status,
      total: sql<string>`COALESCE(SUM(${cashDeposits.amount}), 0)`,
    })
    .from(cashDeposits)
    .where(
      and(
        eq(cashDeposits.outletId, outletId),
        gte(cashDeposits.depositDate, fromIso),
        lte(cashDeposits.depositDate, todayIso),
      ),
    )
    .groupBy(cashDeposits.depositDate, cashDeposits.status);
  const dateDepositsVerified = new Map<string, number>();
  const dateDepositsPending = new Map<string, number>();
  for (const r of depositRows) {
    const dateStr = String(r.date);
    if (r.status === "verified") {
      dateDepositsVerified.set(
        dateStr,
        (dateDepositsVerified.get(dateStr) ?? 0) + Number(r.total),
      );
    } else if (r.status === "pending_verification") {
      dateDepositsPending.set(
        dateStr,
        (dateDepositsPending.get(dateStr) ?? 0) + Number(r.total),
      );
    }
  }

  // Anchor sisaAwal: cash on hand at (fromIso - 1).
  // Sesi AE-62h — query historical net cash sebelum window untuk anchor
  // sisaAwal yang akurat. Sebelumnya hardcoded 0 → kalau outlet baru
  // deposit kemarin (sebelum 30 hari ago), historical accumulated cash
  // hilang dari rollup → sisaAkhir under-state untuk hari awal window.
  //
  // Formula: sisaAwal = (all cash sales before fromIso)
  //                   - (all cash expenses before fromIso)
  //                   - (all verified deposits before fromIso)
  // Cheap one-shot query (sum aggregate, no row-by-row walk).
  let sisaAwal = 0;
  {
    const beforeFromIso = subtractDaysIso(fromIso, 1);
    const beforeFromUtc = new Date(`${beforeFromIso}T23:59:59.999+07:00`);
    const [salesBefore] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${transactions.total}), 0)`,
      })
      .from(transactions)
      .innerJoin(shifts, eq(shifts.id, transactions.shiftId))
      .where(
        and(
          eq(transactions.outletId, outletId),
          eq(transactions.paymentMethod, "cash"),
          eq(transactions.status, "paid"),
          eq(shifts.status, "closed"),
          lte(shifts.closedAt, beforeFromUtc),
        ),
      );
    const [refundsBefore] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${transactions.total}), 0)`,
      })
      .from(transactions)
      .innerJoin(shifts, eq(shifts.id, transactions.shiftId))
      .where(
        and(
          eq(transactions.outletId, outletId),
          eq(transactions.paymentMethod, "cash"),
          eq(transactions.status, "refunded"),
          eq(shifts.status, "closed"),
          lte(shifts.closedAt, beforeFromUtc),
        ),
      );
    const [expensesBefore] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)`,
      })
      .from(expenses)
      .where(
        and(
          eq(expenses.outletId, outletId),
          eq(expenses.paymentMethod, "cash"),
          isNull(expenses.deletedAt),
          lte(expenses.expenseDate, beforeFromIso),
        ),
      );
    const [depositsBefore] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${cashDeposits.amount}), 0)`,
      })
      .from(cashDeposits)
      .where(
        and(
          eq(cashDeposits.outletId, outletId),
          eq(cashDeposits.status, "verified"),
          lte(cashDeposits.depositDate, beforeFromIso),
        ),
      );
    sisaAwal =
      Number(salesBefore?.total ?? 0) -
      Number(refundsBefore?.total ?? 0) -
      Number(expensesBefore?.total ?? 0) -
      Number(depositsBefore?.total ?? 0);
  }

  const last30DaysFlow: CashDailyRollup[] = [];
  for (let i = 29; i >= 0; i--) {
    const dateIso = subtractDaysIso(todayIso, i);
    const cashSales = dateCashSales.get(dateIso) ?? 0;
    const cashExpenses = dateExpenses.get(dateIso) ?? 0;
    const depositsVerified = dateDepositsVerified.get(dateIso) ?? 0;
    const depositsPending = dateDepositsPending.get(dateIso) ?? 0;
    const shiftSummary = dateShiftSummary.get(dateIso);
    const sisaAkhir =
      sisaAwal + cashSales - cashExpenses - depositsVerified;
    last30DaysFlow.push({
      date: dateIso,
      sisaAwal,
      cashSales,
      cashExpenses,
      depositsVerified,
      depositsPending,
      sisaAkhir,
      shiftCount: shiftSummary?.shiftIds.length ?? 0,
    });
    sisaAwal = sisaAkhir;
  }

  return {
    asOf: new Date(),
    cashOnHand: onHand.cashOnHand,
    outstandingToDeposit,
    pendingCount,
    pendingTotal,
    lastVerified,
    totalDepositedThisMonth,
    thresholdIdr: onHand.thresholdIdr,
    isOverThreshold: onHand.isOverThreshold,
    last30DaysFlow,
    oldestPendingDays,
    isCashNegative: onHand.cashOnHand < 0,
  };
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

/**
 * Sesi AE-56 — Rekonsiliasi tabel revamp:
 * - Tambah row "cash" (3-way: POS sales / Kasir Lapor / Setoran Bank verified)
 * - Fix QRIS hardcoded 0 → pakai shifts.qrisSettlement (AE-56 auto-fill at close)
 * - Tambah totals + anomalies untuk header stat + alert banner
 * - Tambah status per channel per range (latest entry kalau multi-day,
 *   atau "open" default). Untuk multi-day range, note di-skip (rendered di drill-down).
 */
export async function getSettlementReconciliation(
  outletId: string,
  fromIso: string,
  toIso: string,
): Promise<SettlementReconciliationReport> {
  const aggregatorChannels: AggregatorChannel[] = [
    "edc_bca",
    "gofood",
    "grabfood",
    "shopeefood",
    "qris",
  ];

  const { from, to } = jakartaRangeBounds(fromIso, toIso);

  // ---- Sum kasir-reported settlement fields from shifts that closed in window ----
  const shiftAgg = await db
    .select({
      edc: sql<string>`COALESCE(SUM(${shifts.edcSettlement}), 0)`,
      gofood: sql<string>`COALESCE(SUM(${shifts.gofoodSettlement}), 0)`,
      grabfood: sql<string>`COALESCE(SUM(${shifts.grabfoodSettlement}), 0)`,
      shopeefood: sql<string>`COALESCE(SUM(${shifts.shopeefoodSettlement}), 0)`,
      /* Sesi AE-56 — auto-fill qris di closeShift; fallback ke 0 untuk
       * shift legacy yang belum punya field. Untuk shift lama, lazy-compute
       * di bawah (lihat qrisLegacyFallback). */
      qris: sql<string>`COALESCE(SUM(${shifts.qrisSettlement}), 0)`,
      /* Sesi AE-56 — kasir-lapor cash (derived dari actualCash - openingCash
       * - paidQris - paidCard untuk shift lama yang belum punya cashSalesReported).
       * Untuk row Cash: sebagai backstop kalau kasir tidak input cashSalesReported. */
      cashReportedExplicit: sql<string>`COALESCE(SUM(${shifts.cashSalesReported}), 0)`,
      actualCashSum: sql<string>`COALESCE(SUM(${shifts.actualCash}), 0)`,
      openingCashSum: sql<string>`COALESCE(SUM(${shifts.openingCash}), 0)`,
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

  // ---- POS Actual per payment method (net of refundedAmount) ----
  const trxAgg = await db
    .select({
      paymentMethod: transactions.paymentMethod,
      total: sql<string>`COALESCE(SUM(${transactions.total} - ${transactions.refundedAmount}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.outletId, outletId),
        inArray(transactions.status, ["paid", "partially_refunded"]),
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
        inArray(transactions.status, ["paid", "partially_refunded"]),
        gte(transactions.createdAt, from),
        lte(transactions.createdAt, to),
      ),
    )
    .groupBy(splitPayments.paymentMethod);

  function sumOf(method: string): number {
    return (
      Number(trxAgg.find((r) => r.paymentMethod === method)?.total ?? 0) +
      Number(splitAgg.find((r) => r.paymentMethod === method)?.total ?? 0)
    );
  }

  const cashPosActual = sumOf("cash");
  const cardBcaActual = sumOf("card_bca");
  const qrisActual = sumOf("qris");
  // Other card payments aggregated separately (not displayed in current channels)
  const cardOthersActual =
    sumOf("card_bni") +
    sumOf("card_mandiri") +
    sumOf("card_bri") +
    sumOf("card_other");

  const posActualByChannel: Record<AggregatorChannel, number | null> = {
    cash: cashPosActual,
    edc_bca: cardBcaActual,
    qris: qrisActual,
    gofood: null,
    grabfood: null,
    shopeefood: null,
  };

  // ---- Kasir-Lapor (derived) untuk Cash channel ----
  // Strategi: kalau ada shifts.cashSalesReported explicit → pakai itu.
  // Kalau tidak (cashReportedExplicit = 0), derive: actualCashSum - openingCashSum
  // - paidQris (qrisSettlement) - paidCard (edcSettlement) + refundedCash.
  // Itu net cash flow ke drawer dari shift = sales cash - refund cash.
  //
  // Sesi AE-62g — tambah refundedCash dari transactions di window. Sebelumnya
  // formula miss refund subtraction → derived over-state cash → false-positive
  // "cash leak" alert vs setoran bank.
  const cashReportedExplicit = Number(shiftAgg[0]?.cashReportedExplicit ?? 0);
  const actualCashSum = Number(shiftAgg[0]?.actualCashSum ?? 0);
  const openingCashSum = Number(shiftAgg[0]?.openingCashSum ?? 0);
  const edcReported = Number(shiftAgg[0]?.edc ?? 0);
  const qrisReportedRaw = Number(shiftAgg[0]?.qris ?? 0);
  // Cash refunded di window — both full & partial. Untuk full refund cash,
  // physical cash sudah keluar drawer; untuk partial, refundedAmount keluar.
  const cashRefundAgg = await db
    .select({
      refundedCash: sql<string>`COALESCE(SUM(
        CASE WHEN ${transactions.status} = 'partially_refunded'
             THEN ${transactions.refundedAmount}
             WHEN ${transactions.status} = 'refunded'
             THEN ${transactions.total}
             ELSE 0 END
      ), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.outletId, outletId),
        eq(transactions.paymentMethod, "cash"),
        inArray(transactions.status, ["partially_refunded", "refunded"]),
        gte(transactions.createdAt, from),
        lte(transactions.createdAt, to),
      ),
    );
  const refundedCashSum = Number(cashRefundAgg[0]?.refundedCash ?? 0);
  const cashReportedDerived =
    actualCashSum - openingCashSum - qrisReportedRaw - edcReported + refundedCashSum;
  const cashReported =
    cashReportedExplicit > 0 ? cashReportedExplicit : Math.max(0, cashReportedDerived);

  // ---- Setoran Bank verified untuk Cash channel ----
  const cashDepositAgg = await db
    .select({
      total: sql<string>`COALESCE(SUM(${cashDeposits.amount}), 0)`,
    })
    .from(cashDeposits)
    .where(
      and(
        eq(cashDeposits.outletId, outletId),
        eq(cashDeposits.status, "verified"),
        gte(cashDeposits.depositDate, fromIso),
        lte(cashDeposits.depositDate, toIso),
      ),
    );
  const cashBankSettled = Number(cashDepositAgg[0]?.total ?? 0);

  const reportedByChannel: Record<AggregatorChannel, number> = {
    cash: cashReported,
    edc_bca: edcReported,
    gofood: Number(shiftAgg[0]?.gofood ?? 0),
    grabfood: Number(shiftAgg[0]?.grabfood ?? 0),
    shopeefood: Number(shiftAgg[0]?.shopeefood ?? 0),
    qris: qrisReportedRaw > 0 ? qrisReportedRaw : qrisActual,
    // ↑ Sesi AE-56 lazy fallback: kalau qrisSettlement legacy = 0 tapi
    //   ada POS qris transaksi, pakai POS Actual sebagai "Reported"
    //   (asumsi: kalau auto-fill berlaku, kedua angka match).
  };

  // ---- Aggregator settlements per channel (only non-cash channels) ----
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
        // Sesi AE-62g — interval overlap check (A.from <= B.to AND A.to >= B.from)
        // instead of strict contains. Sebelumnya: settlement multi-day yang
        // melampaui window terlewat — misal settlement period 10-25 di-query
        // untuk 15-20 → exclude → variance reconciliation salah blame kasir.
        lte(aggregatorSettlements.periodFrom, toIso),
        gte(aggregatorSettlements.periodTo, fromIso),
      ),
    )
    .groupBy(aggregatorSettlements.channel);

  // ---- Reconciliation notes (latest per channel) ----
  const notesRows = await db
    .select({
      channel: reconciliationNotes.channel,
      status: reconciliationNotes.status,
      note: reconciliationNotes.note,
      updatedAt: reconciliationNotes.updatedAt,
    })
    .from(reconciliationNotes)
    .where(
      and(
        eq(reconciliationNotes.outletId, outletId),
        gte(reconciliationNotes.periodDate, fromIso),
        lte(reconciliationNotes.periodDate, toIso),
      ),
    )
    .orderBy(desc(reconciliationNotes.updatedAt));

  const latestNoteByChannel = new Map<
    string,
    { status: ReconciliationStatus; note: string | null }
  >();
  for (const n of notesRows) {
    if (!latestNoteByChannel.has(n.channel)) {
      latestNoteByChannel.set(n.channel, {
        status: n.status as ReconciliationStatus,
        note: n.note,
      });
    }
  }

  // ---- Assemble rows (cash first, then aggregator channels) ----
  const allChannels: AggregatorChannel[] = ["cash", ...aggregatorChannels];

  const rows: SettlementReconciliationRow[] = allChannels.map((ch) => {
    const agg = aggRows.find((r) => r.channel === ch);
    const aggGross = Number(agg?.gross ?? 0);
    const aggFee = Number(agg?.fee ?? 0);
    const aggNet = Number(agg?.net ?? 0);
    const reported = reportedByChannel[ch];
    const posActual = posActualByChannel[ch];
    const note = latestNoteByChannel.get(ch);

    if (ch === "cash") {
      return {
        channel: ch,
        reportedFromShifts: reported,
        posActual: posActual ?? 0,
        aggregatorGross: 0,
        aggregatorFee: 0,
        aggregatorNet: 0,
        bankSettled: cashBankSettled,
        varianceShiftsVsAggregator: 0,
        variancePosVsAggregator: null,
        varianceCashPosVsReported: (posActual ?? 0) - reported,
        varianceCashReportedVsBank: reported - cashBankSettled,
        status: note?.status ?? "open",
        note: note?.note ?? null,
      };
    }

    return {
      channel: ch,
      reportedFromShifts: reported,
      posActual: posActual ?? 0,
      aggregatorGross: aggGross,
      aggregatorFee: aggFee,
      aggregatorNet: aggNet,
      bankSettled: 0,
      varianceShiftsVsAggregator: reported - aggGross,
      variancePosVsAggregator: posActual !== null ? posActual - aggGross : null,
      varianceCashPosVsReported: null,
      varianceCashReportedVsBank: null,
      status: note?.status ?? "open",
      note: note?.note ?? null,
    };
  });

  // Mention cardOthersActual to keep variable alive for future use
  void cardOthersActual;

  const totals = computeReconciliationTotals(rows);
  const anomalies = detectReconciliationAnomalies(rows);

  return {
    rangeFrom: fromIso,
    rangeTo: toIso,
    rows,
    totals,
    anomalies,
  };
}

/* ============================================================================
 * Sesi AE-56 — Drill-down per channel: list transaksi POS, shift reports,
 * aggregator settlements, deposits (cash only). Hard limit 500 per kategori.
 * ========================================================================== */

const DRILL_HARD_LIMIT = 500;

export async function fetchReconciliationDrillDown(
  outletId: string,
  channel: AggregatorChannel,
  fromIso: string,
  toIso: string,
): Promise<ReconciliationDrillDown> {
  const { from, to } = jakartaRangeBounds(fromIso, toIso);

  // Mapping channel → paymentMethod filter untuk transactions
  const paymentMethodFilter: Record<AggregatorChannel, string[]> = {
    cash: ["cash"],
    qris: ["qris"],
    edc_bca: ["card_bca"],
    gofood: [], // aggregator-only, no POS payment method
    grabfood: [],
    shopeefood: [],
  };

  const methods = paymentMethodFilter[channel];

  // 1. Transactions
  let transactionsList: ReconciliationDrillDown["transactions"] = [];
  let transactionsSum = 0;
  if (methods.length > 0) {
    const trxRows = await db
      .select({
        id: transactions.id,
        transactionNumber: transactions.transactionNumber,
        closedAt: transactions.createdAt,
        cashierName: users.name,
        total: transactions.total,
        refundedAmount: transactions.refundedAmount,
        paymentMethod: transactions.paymentMethod,
        status: transactions.status,
      })
      .from(transactions)
      .leftJoin(users, eq(users.id, transactions.cashierId))
      .where(
        and(
          eq(transactions.outletId, outletId),
          inArray(transactions.status, ["paid", "partially_refunded"]),
          inArray(transactions.paymentMethod, methods as ("cash" | "qris" | "card_bca")[]),
          gte(transactions.createdAt, from),
          lte(transactions.createdAt, to),
        ),
      )
      .orderBy(desc(transactions.createdAt))
      .limit(DRILL_HARD_LIMIT);

    transactionsList = trxRows.map((t) => {
      const total = Number(t.total);
      const refunded = Number(t.refundedAmount);
      return {
        transactionId: t.id,
        transactionNumber: t.transactionNumber,
        closedAt: t.closedAt.toISOString(),
        cashierName: t.cashierName,
        total,
        refundedAmount: refunded,
        netTotal: total - refunded,
        paymentMethod: t.paymentMethod,
        status: t.status,
      };
    });
    transactionsSum = transactionsList.reduce((s, t) => s + t.netTotal, 0);
  }

  // 2. Shift reports (kasir-reported settlement per shift)
  const shiftFieldMap: Record<
    AggregatorChannel,
    keyof typeof shifts.$inferSelect | null
  > = {
    cash: null, // cash is derived, not single field
    edc_bca: "edcSettlement",
    qris: "qrisSettlement",
    gofood: "gofoodSettlement",
    grabfood: "grabfoodSettlement",
    shopeefood: "shopeefoodSettlement",
  };
  const fieldName = shiftFieldMap[channel];

  let shiftReports: ReconciliationDrillDown["shiftReports"] = [];
  let shiftReportsSum = 0;
  if (channel !== "cash" && fieldName) {
    const shiftRows = await db
      .select({
        id: shifts.id,
        closedAt: shifts.closedAt,
        userName: users.name,
        edc: shifts.edcSettlement,
        gofood: shifts.gofoodSettlement,
        grabfood: shifts.grabfoodSettlement,
        shopeefood: shifts.shopeefoodSettlement,
        qris: shifts.qrisSettlement,
      })
      .from(shifts)
      .innerJoin(users, eq(users.id, shifts.userId))
      .where(
        and(
          eq(shifts.outletId, outletId),
          eq(shifts.status, "closed"),
          gte(shifts.closedAt, from),
          lte(shifts.closedAt, to),
        ),
      )
      .orderBy(desc(shifts.closedAt))
      .limit(DRILL_HARD_LIMIT);

    shiftReports = shiftRows.map((s) => {
      const closedAt = s.closedAt ?? new Date();
      const wibDate = new Date(closedAt.getTime() + 7 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const amount =
        channel === "edc_bca"
          ? Number(s.edc ?? 0)
          : channel === "qris"
            ? Number(s.qris ?? 0)
            : channel === "gofood"
              ? Number(s.gofood ?? 0)
              : channel === "grabfood"
                ? Number(s.grabfood ?? 0)
                : Number(s.shopeefood ?? 0);
      return {
        shiftId: s.id,
        shiftDate: wibDate,
        cashierName: s.userName,
        reportedAmount: amount,
      };
    });
    shiftReportsSum = shiftReports.reduce((s, r) => s + r.reportedAmount, 0);
  } else if (channel === "cash") {
    // For cash, list each shift's derived cash sales
    const shiftRows = await db
      .select({
        id: shifts.id,
        closedAt: shifts.closedAt,
        userName: users.name,
        actualCash: shifts.actualCash,
        openingCash: shifts.openingCash,
        edc: shifts.edcSettlement,
        qris: shifts.qrisSettlement,
        cashSalesReported: shifts.cashSalesReported,
      })
      .from(shifts)
      .innerJoin(users, eq(users.id, shifts.userId))
      .where(
        and(
          eq(shifts.outletId, outletId),
          eq(shifts.status, "closed"),
          gte(shifts.closedAt, from),
          lte(shifts.closedAt, to),
        ),
      )
      .orderBy(desc(shifts.closedAt))
      .limit(DRILL_HARD_LIMIT);

    shiftReports = shiftRows.map((s) => {
      const closedAt = s.closedAt ?? new Date();
      const wibDate = new Date(closedAt.getTime() + 7 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const explicit = s.cashSalesReported == null ? 0 : Number(s.cashSalesReported);
      const derived =
        Number(s.actualCash ?? 0) -
        Number(s.openingCash ?? 0) -
        Number(s.qris ?? 0) -
        Number(s.edc ?? 0);
      const amount = explicit > 0 ? explicit : Math.max(0, derived);
      return {
        shiftId: s.id,
        shiftDate: wibDate,
        cashierName: s.userName,
        reportedAmount: amount,
      };
    });
    shiftReportsSum = shiftReports.reduce((s, r) => s + r.reportedAmount, 0);
  }

  // 3. Aggregator settlements (non-cash channels)
  let aggregators: ReconciliationDrillDown["aggregators"] = [];
  let aggregatorsGross = 0;
  if (channel !== "cash") {
    const nonCashChannel = channel as Exclude<AggregatorChannel, "cash">;
    const aggList = await db
      .select()
      .from(aggregatorSettlements)
      .where(
        and(
          eq(aggregatorSettlements.outletId, outletId),
          eq(aggregatorSettlements.channel, nonCashChannel),
          gte(aggregatorSettlements.periodFrom, fromIso),
          lte(aggregatorSettlements.periodTo, toIso),
        ),
      )
      .orderBy(desc(aggregatorSettlements.periodFrom))
      .limit(DRILL_HARD_LIMIT);

    aggregators = aggList.map((a) => ({
      settlementId: a.id,
      periodFrom: a.periodFrom,
      periodTo: a.periodTo,
      grossAmount: Number(a.grossAmount),
      feeAmount: Number(a.feeAmount),
      netAmount: Number(a.netAmount),
      referenceNo: a.referenceNo,
      notes: a.notes,
    }));
    aggregatorsGross = aggregators.reduce((s, a) => s + a.grossAmount, 0);
  }

  // 4. Cash deposits (cash channel only)
  let deposits: ReconciliationDrillDown["deposits"] = [];
  let depositsSum = 0;
  if (channel === "cash") {
    const depRows = await db
      .select({
        id: cashDeposits.id,
        depositDate: cashDeposits.depositDate,
        amount: cashDeposits.amount,
        bankDestination: cashDeposits.bankDestination,
        status: cashDeposits.status,
      })
      .from(cashDeposits)
      .where(
        and(
          eq(cashDeposits.outletId, outletId),
          gte(cashDeposits.depositDate, fromIso),
          lte(cashDeposits.depositDate, toIso),
        ),
      )
      .orderBy(desc(cashDeposits.depositDate))
      .limit(DRILL_HARD_LIMIT);

    deposits = depRows.map((d) => ({
      depositId: d.id,
      depositDate: d.depositDate,
      amount: Number(d.amount),
      bankDestination: d.bankDestination,
      status: d.status as CashDepositStatus,
    }));
    depositsSum = deposits
      .filter((d) => d.status === "verified")
      .reduce((s, d) => s + d.amount, 0);
  }

  const truncated =
    transactionsList.length >= DRILL_HARD_LIMIT ||
    shiftReports.length >= DRILL_HARD_LIMIT ||
    aggregators.length >= DRILL_HARD_LIMIT ||
    deposits.length >= DRILL_HARD_LIMIT;

  return {
    channel,
    rangeFrom: fromIso,
    rangeTo: toIso,
    transactions: transactionsList,
    shiftReports,
    aggregators,
    deposits,
    totals: {
      transactionsSum,
      shiftReportsSum,
      aggregatorsGross,
      depositsSum,
    },
    truncated,
  };
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
  if (opts.channel && opts.channel !== "all" && opts.channel !== "cash") {
    conds.push(
      eq(
        aggregatorSettlements.channel,
        opts.channel as Exclude<AggregatorChannel, "cash">,
      ),
    );
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

/**
 * Sesi AE-62h — variance threshold per-outlet. Default 10k (cocok untuk
 * outlet kecil), bisa di-override via Settings → Threshold (UI di
 * SettingsTunablesModal).
 *
 * Sesi AE-62t fix: PATH MISMATCH BUG. UI Settings tulis ke
 * `settings.thresholds.shiftVarianceAlert` (via updateThresholds), tapi
 * helper ini dulu baca dari `settings.shift.varianceThreshold` →
 * threshold owner-set NEVER applied. Sekarang baca dari path UI dulu,
 * fallback ke legacy path kalau pre-fix outlet data masih ada.
 *
 * Sebelumnya: hardcoded 10_000 di ShiftsSection + CloseShiftModal +
 * VerifyDepositModal → alert fatigue di high-volume outlet, atau under-detect
 * di outlet kecil.
 */
export async function getShiftVarianceThreshold(
  outletId: string,
): Promise<number> {
  const [r] = await db
    .select({ settings: sql<Record<string, unknown>>`settings` })
    .from(sql`outlets`)
    .where(sql`id = ${outletId}`)
    .limit(1);
  const settings = (r?.settings ?? {}) as {
    /** Sesi AE-62t — canonical path (matches UI updateThresholds). */
    thresholds?: { shiftVarianceAlert?: number };
    /** Legacy path (pre-fix). Fallback only — UI tidak pernah tulis ke sini,
     * tapi kalau ada data manual hand-edited di DB, honor it. */
    shift?: { varianceThreshold?: number };
  };
  const canonical = settings?.thresholds?.shiftVarianceAlert;
  if (typeof canonical === "number" && canonical >= 0) return canonical;
  const legacy = settings?.shift?.varianceThreshold;
  if (typeof legacy === "number" && legacy >= 0) return legacy;
  return 10_000;
}

// Re-exports so consumers can `import { ... } from "@/features/finance"`.
export { JAKARTA_TZ };
