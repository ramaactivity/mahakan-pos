import "server-only";
import { alias } from "drizzle-orm/pg-core";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs,
  customers,
  expenseCategories,
  expenses,
  historicalDailySummary,
  historicalExpense,
  incomes,
  menuItems,
  refundEventItems,
  refundEvents,
  shifts,
  transactionItems,
  transactions,
  users,
} from "@/db/schema";
import {
  endOfWibDateUtc,
  startOfWibDateUtc,
} from "@/features/cash/helpers";
import type {
  BillPerformanceReport,
  BillRow,
  CategoryBreakdown,
  ClosingShiftReport,
  ClosingShiftRow,
  DailySalesReport,
  HourlyBucket,
  ItemPerformanceRow,
  MenuEngineeringResult,
  PaymentMethodBreakdown,
  PnlReport,
  RefundVoidComplimentDetail,
  RefundVoidComplimentEvent,
  RefundVoidComplimentKind,
  RefundVoidComplimentReport,
  RvcDetailAuditEntry,
  RvcDetailItem,
  SalesRangeReport,
  TopItem,
} from "./types";
import { classifyMenuMatrix } from "./menu-engineering-pure";
import {
  aggregateClosingShifts,
  computeBillStats,
} from "./bill-targets-pure";
import {
  appendIntegrityMismatchAnomaly,
  computeRvcTotals,
  detectRvcAnomalies,
  inventoryWarningMicrocopy,
} from "./refund-void-compliment-pure";
import type { PaymentMethod } from "@/features/transactions";

export async function fetchDailySalesReport(
  outletId: string,
  date: string,
): Promise<DailySalesReport> {
  const dayStart = startOfWibDateUtc(date);
  const dayEnd = endOfWibDateUtc(date);

  const trxs = await db
    .select({
      id: transactions.id,
      status: transactions.status,
      total: transactions.total,
      refundedAmount: transactions.refundedAmount,
      paymentMethod: transactions.paymentMethod,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.outletId, outletId),
        gte(transactions.createdAt, dayStart),
        lt(transactions.createdAt, dayEnd),
      ),
    );

  // Net-sale rows: paid + partially_refunded both count as revenue
  // (with refundedAmount subtracted from total to get net per trx).
  const paid = trxs.filter(
    (t) => t.status === "paid" || t.status === "partially_refunded",
  );
  const voided = trxs.filter((t) => t.status === "voided");
  const refunded = trxs.filter((t) => t.status === "refunded");

  const netTotal = (t: { total: number; refundedAmount: number }) =>
    t.total - t.refundedAmount;
  const revenue = paid.reduce((s, t) => s + netTotal(t), 0);
  const averageTicket =
    paid.length > 0 ? Math.round(revenue / paid.length) : 0;

  const byPaymentMethod: PaymentMethodBreakdown[] = (
    [
      "cash",
      "qris",
      "card_bca",
      "card_bni",
      "card_mandiri",
      "card_bri",
      "card_other",
    ] as const
  )
    .map((method) => {
      const rows = paid.filter((t) => t.paymentMethod === method);
      return {
        method: method as PaymentMethod,
        count: rows.length,
        amount: rows.reduce((s, t) => s + netTotal(t), 0),
      };
    })
    // Hide methods dengan zero transaction agar dashboard tidak penuh row 0
    .filter((row) => row.count > 0);

  // Hourly bucket (WIB)
  const hourlyMap = new Map<number, HourlyBucket>();
  for (const t of paid) {
    const wib = new Date(t.createdAt.getTime() + 7 * 60 * 60 * 1000);
    const hour = wib.getUTCHours();
    const cur = hourlyMap.get(hour) ?? { hour, count: 0, revenue: 0 };
    cur.count += 1;
    cur.revenue += t.total;
    hourlyMap.set(hour, cur);
  }
  const hourlyDistribution = Array.from(hourlyMap.values()).sort(
    (a, b) => a.hour - b.hour,
  );

  // Category + item aggregates from transaction_items joined to paid trxs
  const paidIds = paid.map((p) => p.id);
  let byCategory: CategoryBreakdown[] = [];
  let topItems: TopItem[] = [];
  if (paidIds.length > 0) {
    const itemRows = await db
      .select({
        menuItemId: transactionItems.menuItemId,
        itemName: transactionItems.itemName,
        itemCategoryName: transactionItems.itemCategoryName,
        quantity: transactionItems.quantity,
        subtotal: transactionItems.subtotal,
      })
      .from(transactionItems)
      .where(sql`${transactionItems.transactionId} in ${paidIds}`);

    const catMap = new Map<string, CategoryBreakdown>();
    const itemMap = new Map<string, TopItem>();
    for (const r of itemRows) {
      const c = catMap.get(r.itemCategoryName) ?? {
        categoryName: r.itemCategoryName,
        count: 0,
        revenue: 0,
      };
      c.count += r.quantity;
      c.revenue += r.subtotal;
      catMap.set(r.itemCategoryName, c);

      const i = itemMap.get(r.menuItemId) ?? {
        menuItemId: r.menuItemId,
        name: r.itemName,
        quantity: 0,
        revenue: 0,
      };
      i.quantity += r.quantity;
      i.revenue += r.subtotal;
      itemMap.set(r.menuItemId, i);
    }
    byCategory = Array.from(catMap.values()).sort(
      (a, b) => b.revenue - a.revenue,
    );
    topItems = Array.from(itemMap.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);
  }

  return {
    date,
    metrics: {
      revenue,
      transactionCount: paid.length,
      averageTicket,
      voidedCount: voided.length,
      voidedAmount: voided.reduce((s, t) => s + t.total, 0),
      refundedCount: refunded.length,
      refundedAmount: refunded.reduce((s, t) => s + t.total, 0),
    },
    byPaymentMethod,
    byCategory,
    topItems,
    hourlyDistribution,
  };
}

export async function fetchItemPerformance(
  outletId: string,
  from: string,
  to: string,
  sortKey: "qty" | "revenue" | "avg",
  limit: number,
): Promise<ItemPerformanceRow[]> {
  const fromUtc = startOfWibDateUtc(from);
  const toUtc = endOfWibDateUtc(to);

  const rows = await db
    .select({
      menuItemId: transactionItems.menuItemId,
      itemName: transactionItems.itemName,
      categoryName: transactionItems.itemCategoryName,
      quantity: sql<number>`sum(${transactionItems.quantity})::int`,
      revenue: sql<number>`sum(${transactionItems.subtotal})::bigint`,
      cogs: sql<number>`coalesce(sum(${transactionItems.cogs}), 0)::bigint`,
      cogsCount: sql<number>`count(${transactionItems.cogs})::int`,
    })
    .from(transactionItems)
    .innerJoin(transactions, eq(transactions.id, transactionItems.transactionId))
    .where(
      and(
        eq(transactions.outletId, outletId),
        inArray(transactions.status, ["paid", "partially_refunded"]),
        gte(transactions.createdAt, fromUtc),
        lt(transactions.createdAt, toUtc),
      ),
    )
    .groupBy(
      transactionItems.menuItemId,
      transactionItems.itemName,
      transactionItems.itemCategoryName,
    );

  const enriched: ItemPerformanceRow[] = rows.map((r) => {
    const revenue = Number(r.revenue);
    const cogs = Number(r.cogs);
    const cogsCount = Number(r.cogsCount);
    const hasCogs = cogsCount > 0 && cogs > 0;
    const marginPct =
      hasCogs && revenue > 0
        ? Math.round(((revenue - cogs) / revenue) * 100)
        : null;
    return {
      menuItemId: r.menuItemId,
      name: r.itemName,
      categoryName: r.categoryName,
      quantity: Number(r.quantity),
      revenue,
      averageOrderValue:
        Number(r.quantity) > 0 ? Math.round(revenue / Number(r.quantity)) : 0,
      cogs: hasCogs ? cogs : null,
      marginPct,
    };
  });

  enriched.sort((a, b) => {
    if (sortKey === "revenue") return b.revenue - a.revenue;
    if (sortKey === "avg") return b.averageOrderValue - a.averageOrderValue;
    return b.quantity - a.quantity;
  });

  return enriched.slice(0, limit);
}

/**
 * M23.6 — Menu engineering matrix. Reuses fetchItemPerformance (no limit cap)
 * and classifies via pure helper (median split on qty + contribMargin Rp).
 */
export async function fetchMenuEngineeringMatrix(
  outletId: string,
  from: string,
  to: string,
): Promise<MenuEngineeringResult> {
  // Fetch all items with sales (limit=500 covers Mahakan's 43 menu items easily,
  // and matches the action-layer cap).
  const rows = await fetchItemPerformance(outletId, from, to, "qty", 500);
  return classifyMenuMatrix(rows);
}

export async function fetchPnlReport(
  outletId: string,
  from: string,
  to: string,
): Promise<PnlReport> {
  const fromUtc = startOfWibDateUtc(from);
  const toUtc = endOfWibDateUtc(to);

  const [revRow] = await db
    .select({
      // Net revenue: total - refunded_amount, so partial refunds are
      // automatically subtracted at the SQL aggregation level.
      revenue: sql<number>`coalesce(sum(${transactions.total} - ${transactions.refundedAmount}), 0)::bigint`,
      cogs: sql<number>`coalesce(sum(${transactions.cogs}), 0)::bigint`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.outletId, outletId),
        inArray(transactions.status, ["paid", "partially_refunded"]),
        gte(transactions.createdAt, fromUtc),
        lt(transactions.createdAt, toUtc),
      ),
    );
  const posRevenue = Number(revRow?.revenue ?? 0);
  const cogs = Number(revRow?.cogs ?? 0);

  const [incRow] = await db
    .select({
      total: sql<number>`coalesce(sum(${incomes.amount}), 0)::bigint`,
    })
    .from(incomes)
    .where(
      and(
        eq(incomes.outletId, outletId),
        gte(incomes.incomeDate, from),
        lte(incomes.incomeDate, to),
        isNull(incomes.deletedAt),
      ),
    );
  const manualIncome = Number(incRow?.total ?? 0);

  const expenseRows = await db
    .select({
      name: expenseCategories.name,
      amount: sql<number>`coalesce(sum(${expenses.amount}), 0)::bigint`,
    })
    .from(expenses)
    .innerJoin(
      expenseCategories,
      eq(expenseCategories.id, expenses.categoryId),
    )
    .where(
      and(
        eq(expenses.outletId, outletId),
        gte(expenses.expenseDate, from),
        lte(expenses.expenseDate, to),
        isNull(expenses.deletedAt),
      ),
    )
    .groupBy(expenseCategories.id, expenseCategories.name);

  const byCategory = expenseRows
    .map((e) => ({ name: e.name, amount: Number(e.amount) }))
    .filter((e) => e.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const expensesTotal = byCategory.reduce((s, e) => s + e.amount, 0);

  /* Sesi AE-62 — merge historical_daily_summary + historical_expense ke
   * P&L report. Range overlap: same `from`/`to` ISO. Historical entry
   * represent business days dari Majoo/Kasir Pintar sebelum trial. */
  const [histRevRow] = await db
    .select({
      net: sql<number>`coalesce(sum(${historicalDailySummary.netRevenue}), 0)::bigint`,
      cogs: sql<number>`coalesce(sum(${historicalDailySummary.cogs}), 0)::bigint`,
    })
    .from(historicalDailySummary)
    .where(
      and(
        eq(historicalDailySummary.outletId, outletId),
        gte(historicalDailySummary.businessDate, from),
        lte(historicalDailySummary.businessDate, to),
      ),
    );
  const historicalIncome = Number(histRevRow?.net ?? 0);
  const historicalCogs = Number(histRevRow?.cogs ?? 0);

  const [histExpRow] = await db
    .select({
      total: sql<number>`coalesce(sum(${historicalExpense.amount}), 0)::bigint`,
    })
    .from(historicalExpense)
    .where(
      and(
        eq(historicalExpense.outletId, outletId),
        gte(historicalExpense.businessDate, from),
        lte(historicalExpense.businessDate, to),
      ),
    );
  const historicalExpenseTotal = Number(histExpRow?.total ?? 0);

  const totalIncome = posRevenue + manualIncome + historicalIncome;
  const grossMargin = totalIncome - cogs - historicalCogs;
  const netProfit = grossMargin - expensesTotal - historicalExpenseTotal;

  return {
    period: { from, to },
    income: {
      posRevenue,
      manualIncome,
      historicalIncome,
      total: totalIncome,
    },
    cogs,
    historicalCogs,
    grossMargin,
    expenses: {
      byCategory,
      historicalTotal: historicalExpenseTotal,
      total: expensesTotal + historicalExpenseTotal,
    },
    netProfit,
    disclaimer:
      "Ini bukan laporan akuntansi resmi. Hanya summary arus kas sederhana. COGS = HPP yang ter-snapshot saat transaksi paid. Data 'Histori' = import dari POS sebelumnya (Majoo/Kasir Pintar).",
  };
}

/**
 * Aggregate sales for a date range, with daily buckets and prior-period
 * comparison. Used for weekly + monthly views.
 *
 * The "prior period" is automatically the same number of WIB days immediately
 * preceding the queried range — e.g. a Mon–Sun query compares against the
 * preceding Mon–Sun.
 */
export async function fetchSalesRangeReport(
  outletId: string,
  from: string,
  to: string,
): Promise<SalesRangeReport> {
  const fromUtc = startOfWibDateUtc(from);
  const toUtc = endOfWibDateUtc(to);

  const trxs = await db
    .select({
      id: transactions.id,
      status: transactions.status,
      total: transactions.total,
      refundedAmount: transactions.refundedAmount,
      paymentMethod: transactions.paymentMethod,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.outletId, outletId),
        gte(transactions.createdAt, fromUtc),
        lt(transactions.createdAt, toUtc),
      ),
    );

  const paid = trxs.filter(
    (t) => t.status === "paid" || t.status === "partially_refunded",
  );
  const voided = trxs.filter((t) => t.status === "voided");
  const refunded = trxs.filter((t) => t.status === "refunded");

  const netTotal = (t: { total: number; refundedAmount: number }) =>
    t.total - t.refundedAmount;
  const revenue = paid.reduce((s, t) => s + netTotal(t), 0);
  const averageTicket =
    paid.length > 0 ? Math.round(revenue / paid.length) : 0;

  const byPaymentMethod: PaymentMethodBreakdown[] = (
    [
      "cash",
      "qris",
      "card_bca",
      "card_bni",
      "card_mandiri",
      "card_bri",
      "card_other",
    ] as const
  )
    .map((method) => {
      const rows = paid.filter((t) => t.paymentMethod === method);
      return {
        method: method as PaymentMethod,
        count: rows.length,
        amount: rows.reduce((s, t) => s + netTotal(t), 0),
      };
    })
    .filter((row) => row.count > 0);

  // Build daily bucket map (WIB day key)
  const wibDateKey = (d: Date) => {
    const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    return `${wib.getUTCFullYear()}-${String(wib.getUTCMonth() + 1).padStart(2, "0")}-${String(wib.getUTCDate()).padStart(2, "0")}`;
  };
  const dayBuckets = new Map<string, { revenue: number; transactionCount: number }>();
  for (const t of paid) {
    const key = wibDateKey(t.createdAt);
    const cur = dayBuckets.get(key) ?? { revenue: 0, transactionCount: 0 };
    cur.revenue += netTotal(t);
    cur.transactionCount += 1;
    dayBuckets.set(key, cur);
  }
  /* Sesi AE-62 — fetch historical_daily_summary di range untuk merge ke
   * byDay. Live data wins kalau tanggal overlap (live row pasti ada karena
   * dayBuckets tidak null di range). Historical fill gap atau days kosong. */
  const historicalDays = await db
    .select({
      date: historicalDailySummary.businessDate,
      net: historicalDailySummary.netRevenue,
      trx: historicalDailySummary.transactionCount,
      sourceLabel: historicalDailySummary.sourceLabel,
    })
    .from(historicalDailySummary)
    .where(
      and(
        eq(historicalDailySummary.outletId, outletId),
        gte(historicalDailySummary.businessDate, from),
        lte(historicalDailySummary.businessDate, to),
      ),
    );
  const historicalMap = new Map<
    string,
    { revenue: number; transactionCount: number; sourceLabel: string | null }
  >();
  for (const h of historicalDays) {
    historicalMap.set(h.date, {
      revenue: Number(h.net),
      transactionCount: h.trx,
      sourceLabel: h.sourceLabel,
    });
  }

  // Fill gaps so charts have continuous time series
  const byDay: SalesRangeReport["byDay"] = [];
  const cursor = new Date(`${from}T00:00:00+07:00`);
  const end = new Date(`${to}T00:00:00+07:00`);
  while (cursor <= end) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    const live = dayBuckets.get(key);
    const hist = historicalMap.get(key);
    if (live && live.revenue > 0) {
      byDay.push({
        date: key,
        revenue: live.revenue,
        transactionCount: live.transactionCount,
      });
    } else if (hist) {
      byDay.push({
        date: key,
        revenue: hist.revenue,
        transactionCount: hist.transactionCount,
        isHistorical: true,
        sourceLabel: hist.sourceLabel,
      });
    } else {
      byDay.push({
        date: key,
        revenue: live?.revenue ?? 0,
        transactionCount: live?.transactionCount ?? 0,
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  // Category + top items
  const paidIds = paid.map((p) => p.id);
  let byCategory: CategoryBreakdown[] = [];
  let topItems: TopItem[] = [];
  if (paidIds.length > 0) {
    const itemRows = await db
      .select({
        menuItemId: transactionItems.menuItemId,
        itemName: transactionItems.itemName,
        itemCategoryName: transactionItems.itemCategoryName,
        quantity: transactionItems.quantity,
        subtotal: transactionItems.subtotal,
      })
      .from(transactionItems)
      .where(sql`${transactionItems.transactionId} in ${paidIds}`);

    const catMap = new Map<string, CategoryBreakdown>();
    const itemMap = new Map<string, TopItem>();
    for (const r of itemRows) {
      const c = catMap.get(r.itemCategoryName) ?? {
        categoryName: r.itemCategoryName,
        count: 0,
        revenue: 0,
      };
      c.count += r.quantity;
      c.revenue += r.subtotal;
      catMap.set(r.itemCategoryName, c);

      const i = itemMap.get(r.menuItemId) ?? {
        menuItemId: r.menuItemId,
        name: r.itemName,
        quantity: 0,
        revenue: 0,
      };
      i.quantity += r.quantity;
      i.revenue += r.subtotal;
      itemMap.set(r.menuItemId, i);
    }
    byCategory = Array.from(catMap.values()).sort(
      (a, b) => b.revenue - a.revenue,
    );
    topItems = Array.from(itemMap.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);
  }

  // Prior period: same length immediately before
  const dayCount = byDay.length;
  const priorEnd = new Date(`${from}T00:00:00+07:00`);
  priorEnd.setDate(priorEnd.getDate() - 1);
  const priorStart = new Date(priorEnd);
  priorStart.setDate(priorStart.getDate() - (dayCount - 1));
  const priorFromIso = `${priorStart.getFullYear()}-${String(priorStart.getMonth() + 1).padStart(2, "0")}-${String(priorStart.getDate()).padStart(2, "0")}`;
  const priorToIso = `${priorEnd.getFullYear()}-${String(priorEnd.getMonth() + 1).padStart(2, "0")}-${String(priorEnd.getDate()).padStart(2, "0")}`;
  const priorFromUtc = startOfWibDateUtc(priorFromIso);
  const priorToUtc = endOfWibDateUtc(priorToIso);

  const [priorAgg] = await db
    .select({
      revenue: sql<number>`coalesce(sum(${transactions.total}), 0)::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.outletId, outletId),
        inArray(transactions.status, ["paid", "partially_refunded"]),
        gte(transactions.createdAt, priorFromUtc),
        lt(transactions.createdAt, priorToUtc),
      ),
    );
  const priorRevenue = Number(priorAgg?.revenue ?? 0);
  const priorCount = Number(priorAgg?.count ?? 0);

  const pct = (cur: number, prev: number) =>
    prev === 0 ? null : Math.round(((cur - prev) / prev) * 1000) / 10;

  return {
    period: { from, to },
    metrics: {
      revenue,
      transactionCount: paid.length,
      averageTicket,
      voidedCount: voided.length,
      voidedAmount: voided.reduce((s, t) => s + t.total, 0),
      refundedCount: refunded.length,
      refundedAmount: refunded.reduce((s, t) => s + t.total, 0),
    },
    byPaymentMethod,
    byCategory,
    topItems,
    byDay,
    comparison: {
      period: { from: priorFromIso, to: priorToIso },
      revenue: priorRevenue,
      transactionCount: priorCount,
      revenueChangePct: pct(revenue, priorRevenue),
      transactionCountChangePct: pct(paid.length, priorCount),
    },
  };
}

// keep menuItems referenced for future per-item metrics expansion
export const _kp = menuItems;

// ============================================================================
// Sesi AE-55 — Closing Shift Report
// ============================================================================

/**
 * List shift closed dalam range tanggal + aggregate variance/settlement.
 * Per shift, hitung paidCash/refundedCash dari transactions di shift itu
 * (pakai pattern aggregate SUM, bukan loop per-row).
 */
export async function fetchClosingShiftReport(
  outletId: string,
  from: string,
  to: string,
  varianceThreshold: number,
): Promise<ClosingShiftReport> {
  const fromUtc = startOfWibDateUtc(from);
  const toUtc = endOfWibDateUtc(to);

  const shiftRows = await db
    .select({
      id: shifts.id,
      userId: shifts.userId,
      userName: users.name,
      openingCash: shifts.openingCash,
      actualCash: shifts.actualCash,
      variance: shifts.variance,
      edcSettlement: shifts.edcSettlement,
      gofoodSettlement: shifts.gofoodSettlement,
      grabfoodSettlement: shifts.grabfoodSettlement,
      shopeefoodSettlement: shifts.shopeefoodSettlement,
      openedAt: shifts.openedAt,
      closedAt: shifts.closedAt,
      notes: shifts.notes,
    })
    .from(shifts)
    .innerJoin(users, eq(users.id, shifts.userId))
    .where(
      and(
        eq(shifts.outletId, outletId),
        eq(shifts.status, "closed"),
        gte(shifts.closedAt, fromUtc),
        lt(shifts.closedAt, toUtc),
      ),
    )
    .orderBy(shifts.closedAt);

  let rows: ClosingShiftRow[] = [];
  if (shiftRows.length > 0) {
    const shiftIds = shiftRows.map((s) => s.id);
    const cashAgg = await db
      .select({
        shiftId: transactions.shiftId,
        paidCash: sql<number>`coalesce(sum(case
            when ${transactions.paymentMethod} = 'cash'
             and ${transactions.status} in ('paid','partially_refunded','refunded')
            then ${transactions.total} else 0 end), 0)::bigint`,
        refundedCash: sql<number>`coalesce(sum(case
            when ${transactions.paymentMethod} = 'cash'
             and ${transactions.status} = 'partially_refunded'
            then ${transactions.refundedAmount}
            when ${transactions.paymentMethod} = 'cash'
             and ${transactions.status} = 'refunded'
            then ${transactions.total} else 0 end), 0)::bigint`,
      })
      .from(transactions)
      .where(inArray(transactions.shiftId, shiftIds))
      .groupBy(transactions.shiftId);

    const cashByShift = new Map<string, { paidCash: number; refundedCash: number }>();
    for (const r of cashAgg) {
      cashByShift.set(r.shiftId, {
        paidCash: Number(r.paidCash),
        refundedCash: Number(r.refundedCash),
      });
    }

    rows = shiftRows.map((s) => {
      const cash = cashByShift.get(s.id) ?? { paidCash: 0, refundedCash: 0 };
      const opening = Number(s.openingCash);
      const expected = opening + cash.paidCash - cash.refundedCash;
      const actual = s.actualCash == null ? 0 : Number(s.actualCash);
      const variance = s.variance == null ? actual - expected : Number(s.variance);
      const edc = s.edcSettlement == null ? 0 : Number(s.edcSettlement);
      const gofood = s.gofoodSettlement == null ? 0 : Number(s.gofoodSettlement);
      const grab = s.grabfoodSettlement == null ? 0 : Number(s.grabfoodSettlement);
      const shopee = s.shopeefoodSettlement == null
        ? 0
        : Number(s.shopeefoodSettlement);
      const closedAt = s.closedAt ?? s.openedAt;
      const durationMinutes = Math.max(
        0,
        Math.round((closedAt.getTime() - s.openedAt.getTime()) / 60_000),
      );
      const closedAtIso = closedAt.toISOString();
      const wibDate = new Date(closedAt.getTime() + 7 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      return {
        shiftId: s.id,
        shiftDate: wibDate,
        openedAt: s.openedAt.toISOString(),
        closedAt: closedAtIso,
        durationMinutes,
        userId: s.userId,
        userName: s.userName,
        openingCash: opening,
        paidCash: cash.paidCash,
        refundedCash: cash.refundedCash,
        expectedCash: expected,
        actualCash: actual,
        variance,
        edcSettlement: edc,
        gofoodSettlement: gofood,
        grabfoodSettlement: grab,
        shopeefoodSettlement: shopee,
        settlementTotal: edc + gofood + grab + shopee,
        notes: s.notes,
      };
    });
  }

  const totals = aggregateClosingShifts(rows, varianceThreshold);
  return {
    period: { from, to },
    rows,
    totals,
    varianceThreshold,
  };
}

// ============================================================================
// Sesi AE-55 — Per-Bill Report
// ============================================================================

const BILL_HARD_LIMIT = 1000;

export async function fetchBillPerformance(
  outletId: string,
  from: string,
  to: string,
  paymentFilter: PaymentMethod | "all",
): Promise<BillPerformanceReport> {
  const fromUtc = startOfWibDateUtc(from);
  const toUtc = endOfWibDateUtc(to);

  const baseWhere = [
    eq(transactions.outletId, outletId),
    inArray(transactions.status, ["paid", "partially_refunded"]),
    gte(transactions.createdAt, fromUtc),
    lt(transactions.createdAt, toUtc),
  ];
  if (paymentFilter !== "all") {
    baseWhere.push(eq(transactions.paymentMethod, paymentFilter));
  }

  // Hitung count terlebih dahulu untuk deteksi truncation.
  const [{ count }] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(and(...baseWhere));

  const totalCount = Number(count);
  const truncated = totalCount > BILL_HARD_LIMIT;

  const trxRows = await db
    .select({
      id: transactions.id,
      transactionNumber: transactions.transactionNumber,
      createdAt: transactions.createdAt,
      cashierId: transactions.cashierId,
      cashierName: users.name,
      customerName: transactions.customerName,
      customerMasterName: customers.name,
      total: transactions.total,
      refundedAmount: transactions.refundedAmount,
      paymentMethod: transactions.paymentMethod,
      status: transactions.status,
    })
    .from(transactions)
    .leftJoin(users, eq(users.id, transactions.cashierId))
    .leftJoin(customers, eq(customers.id, transactions.customerId))
    .where(and(...baseWhere))
    .orderBy(sql`${transactions.createdAt} desc`)
    .limit(BILL_HARD_LIMIT);

  const rows: BillRow[] = trxRows.map((t) => {
    const total = Number(t.total);
    const refunded = Number(t.refundedAmount);
    return {
      transactionId: t.id,
      transactionNumber: t.transactionNumber,
      closedAt: t.createdAt.toISOString(),
      userId: t.cashierId,
      userName: t.cashierName,
      customerName: t.customerMasterName ?? t.customerName,
      total,
      refundedAmount: refunded,
      netTotal: total - refunded,
      paymentMethod: t.paymentMethod as PaymentMethod,
      status: t.status as "paid" | "partially_refunded",
    };
  });

  // Hitung stats dari SEMUA row (bukan cuma 1000 limit) — buat akurasi.
  // Kalau truncated, gunakan SUM aggregate untuk total + avg.
  let allNetTotals: number[];
  if (truncated) {
    const aggRows = await db
      .select({
        total: transactions.total,
        refundedAmount: transactions.refundedAmount,
      })
      .from(transactions)
      .where(and(...baseWhere));
    allNetTotals = aggRows.map(
      (r) => Number(r.total) - Number(r.refundedAmount),
    );
  } else {
    allNetTotals = rows.map((r) => r.netTotal);
  }

  const { stats, buckets } = computeBillStats(allNetTotals);

  return {
    period: { from, to },
    paymentFilter,
    stats,
    buckets,
    rows,
    truncated,
  };
}

// ============================================================================
// Sesi AE-59 — Refund / Void / Compliment Report
// ============================================================================

const RVC_HARD_LIMIT = 1000;

/**
 * Unified query yang merge 3 sumber:
 *   - refund_events (full + partial)
 *   - transactions WHERE status='voided'
 *   - transactions WHERE discountReason LIKE 'Compliment:%'
 *
 * Aggregate totals + detect anomalies + integrity check (sum refund_events
 * per trx vs transactions.refundedAmount).
 */
export async function fetchRefundVoidComplimentReport(
  outletId: string,
  fromIso: string,
  toIso: string,
  kindFilter?: RefundVoidComplimentKind[],
): Promise<RefundVoidComplimentReport> {
  const fromUtc = startOfWibDateUtc(fromIso);
  const toUtc = endOfWibDateUtc(toIso);

  const includeRefund =
    !kindFilter ||
    kindFilter.includes("refund_full") ||
    kindFilter.includes("refund_partial");
  const includeVoid = !kindFilter || kindFilter.includes("void");
  const includeCompliment = !kindFilter || kindFilter.includes("compliment");

  /* Cashier (createdBy) + approver alias untuk join 2× users */
  const cashier = alias(users, "cashier_user");
  const approver = alias(users, "approver_user");

  /* ---- Refund events ---- */
  const refundEventsList: RefundVoidComplimentEvent[] = [];
  if (includeRefund) {
    const refundRows = await db
      .select({
        id: refundEvents.id,
        transactionId: refundEvents.transactionId,
        kind: refundEvents.kind,
        totalRefunded: refundEvents.totalRefunded,
        reason: refundEvents.reason,
        createdAt: refundEvents.createdAt,
        cashierName: cashier.name,
        approverName: approver.name,
        transactionNumber: transactions.transactionNumber,
        customerName: transactions.customerName,
      })
      .from(refundEvents)
      .innerJoin(transactions, eq(transactions.id, refundEvents.transactionId))
      .leftJoin(cashier, eq(cashier.id, refundEvents.createdByUserId))
      .leftJoin(approver, eq(approver.id, refundEvents.approverUserId))
      .where(
        and(
          eq(refundEvents.outletId, outletId),
          gte(refundEvents.createdAt, fromUtc),
          lt(refundEvents.createdAt, toUtc),
        ),
      )
      .orderBy(desc(refundEvents.createdAt));

    // Count item lines + sum cogs per event (single batched query)
    if (refundRows.length > 0) {
      const eventIds = refundRows.map((r) => r.id);
      const itemAgg = await db
        .select({
          refundEventId: refundEventItems.refundEventId,
          itemCount: sql<number>`count(*)::int`,
          cogsSum: sql<number>`coalesce(sum(${transactionItems.cogs}), 0)::bigint`,
        })
        .from(refundEventItems)
        .leftJoin(
          transactionItems,
          eq(transactionItems.id, refundEventItems.transactionItemId),
        )
        .where(inArray(refundEventItems.refundEventId, eventIds))
        .groupBy(refundEventItems.refundEventId);

      const aggMap = new Map<string, { itemCount: number; cogsSum: number }>();
      for (const r of itemAgg) {
        aggMap.set(r.refundEventId, {
          itemCount: Number(r.itemCount),
          cogsSum: Number(r.cogsSum),
        });
      }

      for (const r of refundRows) {
        const agg = aggMap.get(r.id) ?? { itemCount: 0, cogsSum: 0 };
        // Pro-rata COGS untuk partial refund: cogsSum sudah per refunded line
        // (refund_event_items × transaction_items.cogs)
        const totalRefunded = Number(r.totalRefunded);
        const cogsImpact = r.kind === "partial" ? agg.cogsSum : 0;
        refundEventsList.push({
          eventId: r.id,
          kind: r.kind === "full" ? "refund_full" : "refund_partial",
          transactionId: r.transactionId,
          transactionNumber: r.transactionNumber,
          occurredAt: r.createdAt.toISOString(),
          cashierName: r.cashierName,
          customerName: r.customerName,
          approverName: r.approverName,
          reason: r.reason,
          amountImpact: totalRefunded,
          cogsImpact,
          itemCount: agg.itemCount,
        });
      }
    }
  }

  /* ---- Void transactions ---- */
  const voidEventsList: RefundVoidComplimentEvent[] = [];
  if (includeVoid) {
    const voidRows = await db
      .select({
        id: transactions.id,
        transactionNumber: transactions.transactionNumber,
        total: transactions.total,
        voidedAt: transactions.voidedAt,
        voidReason: transactions.voidReason,
        customerName: transactions.customerName,
        cashierName: cashier.name,
        approverName: approver.name,
      })
      .from(transactions)
      .leftJoin(cashier, eq(cashier.id, transactions.voidedBy))
      .leftJoin(approver, eq(approver.id, transactions.voidedApprover))
      .where(
        and(
          eq(transactions.outletId, outletId),
          eq(transactions.status, "voided"),
          gte(transactions.voidedAt, fromUtc),
          lt(transactions.voidedAt, toUtc),
        ),
      )
      .orderBy(desc(transactions.voidedAt));

    if (voidRows.length > 0) {
      const trxIds = voidRows.map((r) => r.id);
      const voidItemAgg = await db
        .select({
          transactionId: transactionItems.transactionId,
          itemCount: sql<number>`count(*)::int`,
        })
        .from(transactionItems)
        .where(inArray(transactionItems.transactionId, trxIds))
        .groupBy(transactionItems.transactionId);
      const cntMap = new Map<string, number>();
      for (const r of voidItemAgg) cntMap.set(r.transactionId, Number(r.itemCount));

      for (const r of voidRows) {
        voidEventsList.push({
          eventId: r.id,
          kind: "void",
          transactionId: r.id,
          transactionNumber: r.transactionNumber,
          occurredAt: (r.voidedAt ?? new Date()).toISOString(),
          cashierName: r.cashierName,
          customerName: r.customerName,
          approverName: r.approverName,
          reason: r.voidReason,
          amountImpact: Number(r.total),
          cogsImpact: 0, // stock already restored via void_restore movement
          itemCount: cntMap.get(r.id) ?? 0,
        });
      }
    }
  }

  /* ---- Compliment transactions (discountReason LIKE 'Compliment:%') ---- */
  const complimentEventsList: RefundVoidComplimentEvent[] = [];
  if (includeCompliment) {
    const complimentRows = await db
      .select({
        id: transactions.id,
        transactionNumber: transactions.transactionNumber,
        subtotal: transactions.subtotal,
        discountAmount: transactions.discountAmount,
        discountReason: transactions.discountReason,
        createdAt: transactions.createdAt,
        customerName: transactions.customerName,
        cashierName: cashier.name,
        approverName: approver.name,
      })
      .from(transactions)
      .leftJoin(cashier, eq(cashier.id, transactions.cashierId))
      .leftJoin(approver, eq(approver.id, transactions.discountApprover))
      .where(
        and(
          eq(transactions.outletId, outletId),
          inArray(transactions.status, ["paid", "partially_refunded"]),
          like(transactions.discountReason, "Compliment:%"),
          gte(transactions.createdAt, fromUtc),
          lt(transactions.createdAt, toUtc),
        ),
      )
      .orderBy(desc(transactions.createdAt));

    if (complimentRows.length > 0) {
      const trxIds = complimentRows.map((r) => r.id);
      const complimentItemAgg = await db
        .select({
          transactionId: transactionItems.transactionId,
          itemCount: sql<number>`count(*)::int`,
          cogsSum: sql<number>`coalesce(sum(${transactionItems.cogs}), 0)::bigint`,
        })
        .from(transactionItems)
        .where(inArray(transactionItems.transactionId, trxIds))
        .groupBy(transactionItems.transactionId);
      const aggMap = new Map<string, { itemCount: number; cogsSum: number }>();
      for (const r of complimentItemAgg) {
        aggMap.set(r.transactionId, {
          itemCount: Number(r.itemCount),
          cogsSum: Number(r.cogsSum),
        });
      }

      for (const r of complimentRows) {
        const agg = aggMap.get(r.id) ?? { itemCount: 0, cogsSum: 0 };
        complimentEventsList.push({
          eventId: r.id,
          kind: "compliment",
          transactionId: r.id,
          transactionNumber: r.transactionNumber,
          occurredAt: r.createdAt.toISOString(),
          cashierName: r.cashierName,
          customerName: r.customerName,
          approverName: r.approverName,
          reason: r.discountReason,
          amountImpact: Number(r.discountAmount),
          cogsImpact: agg.cogsSum,
          itemCount: agg.itemCount,
        });
      }
    }
  }

  /* ---- Merge + sort desc + truncate ---- */
  const allEvents = [
    ...refundEventsList,
    ...voidEventsList,
    ...complimentEventsList,
  ];
  allEvents.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const truncated = allEvents.length > RVC_HARD_LIMIT;
  const events = truncated ? allEvents.slice(0, RVC_HARD_LIMIT) : allEvents;

  const totals = computeRvcTotals(events);
  let anomalies = detectRvcAnomalies(events);

  /* Integrity check: sum refund_events per trx == transactions.refundedAmount */
  if (includeRefund && refundEventsList.length > 0) {
    const trxIds = Array.from(
      new Set(refundEventsList.map((r) => r.transactionId)),
    );
    const sumPerTrx = await db
      .select({
        transactionId: refundEvents.transactionId,
        sumRefunded: sql<number>`coalesce(sum(${refundEvents.totalRefunded}), 0)::bigint`,
      })
      .from(refundEvents)
      .where(inArray(refundEvents.transactionId, trxIds))
      .groupBy(refundEvents.transactionId);
    const trxRefundedRows = await db
      .select({
        id: transactions.id,
        transactionNumber: transactions.transactionNumber,
        refundedAmount: transactions.refundedAmount,
      })
      .from(transactions)
      .where(inArray(transactions.id, trxIds));
    const refundedMap = new Map<string, number>();
    for (const r of sumPerTrx) refundedMap.set(r.transactionId, Number(r.sumRefunded));
    const mismatched: string[] = [];
    for (const t of trxRefundedRows) {
      const sumEvents = refundedMap.get(t.id) ?? 0;
      if (Number(t.refundedAmount) !== sumEvents) {
        mismatched.push(t.transactionNumber);
      }
    }
    anomalies = appendIntegrityMismatchAnomaly(anomalies, mismatched);
  }

  return {
    period: { from: fromIso, to: toIso },
    events,
    totals,
    anomalies,
    truncated,
  };
}

export async function fetchRvcEventDetail(
  outletId: string,
  eventId: string,
  kind: RefundVoidComplimentKind,
): Promise<RefundVoidComplimentDetail | null> {
  const cashier = alias(users, "cashier_user");
  const approver = alias(users, "approver_user");

  let event: RefundVoidComplimentEvent | null = null;
  let items: RvcDetailItem[] = [];
  let originalTrxId: string | null = null;

  if (kind === "refund_full" || kind === "refund_partial") {
    const [r] = await db
      .select({
        id: refundEvents.id,
        transactionId: refundEvents.transactionId,
        kind: refundEvents.kind,
        totalRefunded: refundEvents.totalRefunded,
        reason: refundEvents.reason,
        createdAt: refundEvents.createdAt,
        cashierName: cashier.name,
        approverName: approver.name,
        transactionNumber: transactions.transactionNumber,
        customerName: transactions.customerName,
      })
      .from(refundEvents)
      .innerJoin(transactions, eq(transactions.id, refundEvents.transactionId))
      .leftJoin(cashier, eq(cashier.id, refundEvents.createdByUserId))
      .leftJoin(approver, eq(approver.id, refundEvents.approverUserId))
      .where(
        and(
          eq(refundEvents.outletId, outletId),
          eq(refundEvents.id, eventId),
        ),
      )
      .limit(1);
    if (!r) return null;

    const itemRows = await db
      .select({
        itemName: transactionItems.itemName,
        unitPrice: transactionItems.unitPrice,
        cogs: transactionItems.cogs,
        quantityRefunded: refundEventItems.quantityRefunded,
        amountRefunded: refundEventItems.amountRefunded,
      })
      .from(refundEventItems)
      .innerJoin(
        transactionItems,
        eq(transactionItems.id, refundEventItems.transactionItemId),
      )
      .where(eq(refundEventItems.refundEventId, eventId));

    items = itemRows.map((it) => ({
      itemName: it.itemName,
      qty: Number(it.quantityRefunded),
      unitPrice: Number(it.unitPrice),
      amountImpact: Number(it.amountRefunded),
      cogsAmount: it.cogs == null ? 0 : Number(it.cogs),
    }));

    event = {
      eventId: r.id,
      kind: r.kind === "full" ? "refund_full" : "refund_partial",
      transactionId: r.transactionId,
      transactionNumber: r.transactionNumber,
      occurredAt: r.createdAt.toISOString(),
      cashierName: r.cashierName,
      customerName: r.customerName,
      approverName: r.approverName,
      reason: r.reason,
      amountImpact: Number(r.totalRefunded),
      cogsImpact: items.reduce((s, i) => s + i.cogsAmount, 0),
      itemCount: items.length,
    };
    originalTrxId = r.transactionId;
  } else {
    // Void atau Compliment — eventId = transactionId
    const [r] = await db
      .select({
        id: transactions.id,
        transactionNumber: transactions.transactionNumber,
        total: transactions.total,
        subtotal: transactions.subtotal,
        discountAmount: transactions.discountAmount,
        discountReason: transactions.discountReason,
        status: transactions.status,
        voidedAt: transactions.voidedAt,
        voidedBy: transactions.voidedBy,
        voidedApprover: transactions.voidedApprover,
        voidReason: transactions.voidReason,
        discountApprover: transactions.discountApprover,
        cashierId: transactions.cashierId,
        createdAt: transactions.createdAt,
        customerName: transactions.customerName,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.outletId, outletId),
          eq(transactions.id, eventId),
        ),
      )
      .limit(1);
    if (!r) return null;

    // Fetch cashier + approver names dengan ID yang tepat (void vs compliment beda field)
    const cashierUserId = kind === "void" ? r.voidedBy : r.cashierId;
    const approverUserId =
      kind === "void" ? r.voidedApprover : r.discountApprover;
    const userIds = [cashierUserId, approverUserId].filter(
      (x): x is string => Boolean(x),
    );
    let cashierName: string | null = null;
    let approverName: string | null = null;
    if (userIds.length > 0) {
      const userRows = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, userIds));
      for (const u of userRows) {
        if (u.id === cashierUserId) cashierName = u.name;
        if (u.id === approverUserId) approverName = u.name;
      }
    }

    const itemRows = await db
      .select({
        itemName: transactionItems.itemName,
        quantity: transactionItems.quantity,
        unitPrice: transactionItems.unitPrice,
        subtotal: transactionItems.subtotal,
        cogs: transactionItems.cogs,
      })
      .from(transactionItems)
      .where(eq(transactionItems.transactionId, r.id));

    items = itemRows.map((it) => ({
      itemName: it.itemName,
      qty: Number(it.quantity),
      unitPrice: Number(it.unitPrice),
      amountImpact:
        kind === "void"
          ? Number(it.subtotal)
          : // Compliment: items free (price = subtotal but customer pays 0)
            Number(it.subtotal),
      cogsAmount: it.cogs == null ? 0 : Number(it.cogs),
    }));

    if (kind === "void") {
      event = {
        eventId: r.id,
        kind: "void",
        transactionId: r.id,
        transactionNumber: r.transactionNumber,
        occurredAt: (r.voidedAt ?? r.createdAt).toISOString(),
        cashierName,
        customerName: r.customerName,
        approverName,
        reason: r.voidReason,
        amountImpact: Number(r.total),
        cogsImpact: 0,
        itemCount: items.length,
      };
    } else {
      // compliment
      event = {
        eventId: r.id,
        kind: "compliment",
        transactionId: r.id,
        transactionNumber: r.transactionNumber,
        occurredAt: r.createdAt.toISOString(),
        cashierName,
        customerName: r.customerName,
        approverName,
        reason: r.discountReason,
        amountImpact: Number(r.discountAmount),
        cogsImpact: items.reduce((s, i) => s + i.cogsAmount, 0),
        itemCount: items.length,
      };
    }
    originalTrxId = r.id;
  }

  if (!event || !originalTrxId) return null;

  /* Fetch original transaction summary (untuk cross-reference) */
  const [origTrx] = await db
    .select({
      transactionNumber: transactions.transactionNumber,
      total: transactions.total,
      refundedAmount: transactions.refundedAmount,
      status: transactions.status,
      createdAt: transactions.createdAt,
      paymentMethod: transactions.paymentMethod,
    })
    .from(transactions)
    .where(eq(transactions.id, originalTrxId))
    .limit(1);

  /* Audit trail (max 10 chronological entries) */
  const auditRows = await db
    .select({
      eventType: auditLogs.eventType,
      createdAt: auditLogs.createdAt,
      payload: auditLogs.payload,
      userName: users.name,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .where(
      or(
        eq(auditLogs.entityId, originalTrxId),
        eq(auditLogs.entityId, event.eventId),
      ),
    )
    .orderBy(auditLogs.createdAt)
    .limit(10);

  const auditTrail: RvcDetailAuditEntry[] = auditRows.map((r) => {
    const payload = r.payload as Record<string, unknown> | null;
    const summary =
      payload && typeof payload === "object" && "summary" in payload
        ? String(payload.summary)
        : r.eventType;
    return {
      eventType: r.eventType,
      actor: r.userName ?? "System",
      occurredAt: r.createdAt.toISOString(),
      summary,
    };
  });

  const restored = event.kind === "void" || event.kind === "refund_full";

  return {
    event,
    items,
    originalTransaction: origTrx
      ? {
          transactionNumber: origTrx.transactionNumber,
          total: Number(origTrx.total),
          refundedAmount: Number(origTrx.refundedAmount),
          status: origTrx.status,
          closedAt: origTrx.createdAt.toISOString(),
          paymentMethod: origTrx.paymentMethod,
        }
      : {
          transactionNumber: event.transactionNumber,
          total: 0,
          refundedAmount: 0,
          status: "unknown",
          closedAt: event.occurredAt,
          paymentMethod: "—",
        },
    auditTrail,
    inventoryImpact: {
      restored,
      warning: inventoryWarningMicrocopy(event.kind),
    },
  };
}
