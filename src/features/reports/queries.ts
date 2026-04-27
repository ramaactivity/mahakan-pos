import "server-only";
import { and, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  expenseCategories,
  expenses,
  incomes,
  menuItems,
  transactionItems,
  transactions,
} from "@/db/schema";
import {
  endOfWibDateUtc,
  startOfWibDateUtc,
} from "@/features/cash/helpers";
import type {
  CategoryBreakdown,
  DailySalesReport,
  HourlyBucket,
  ItemPerformanceRow,
  PaymentMethodBreakdown,
  PnlReport,
  SalesRangeReport,
  TopItem,
} from "./types";
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

  const paid = trxs.filter((t) => t.status === "paid");
  const voided = trxs.filter((t) => t.status === "voided");
  const refunded = trxs.filter((t) => t.status === "refunded");

  const revenue = paid.reduce((s, t) => s + t.total, 0);
  const averageTicket =
    paid.length > 0 ? Math.round(revenue / paid.length) : 0;

  const byPaymentMethod: PaymentMethodBreakdown[] = (
    ["cash", "qris", "card_bca"] as const
  ).map((method) => {
    const rows = paid.filter((t) => t.paymentMethod === method);
    return {
      method: method as PaymentMethod,
      count: rows.length,
      amount: rows.reduce((s, t) => s + t.total, 0),
    };
  });

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
    })
    .from(transactionItems)
    .innerJoin(transactions, eq(transactions.id, transactionItems.transactionId))
    .where(
      and(
        eq(transactions.outletId, outletId),
        eq(transactions.status, "paid"),
        gte(transactions.createdAt, fromUtc),
        lt(transactions.createdAt, toUtc),
      ),
    )
    .groupBy(
      transactionItems.menuItemId,
      transactionItems.itemName,
      transactionItems.itemCategoryName,
    );

  const enriched: ItemPerformanceRow[] = rows.map((r) => ({
    menuItemId: r.menuItemId,
    name: r.itemName,
    categoryName: r.categoryName,
    quantity: Number(r.quantity),
    revenue: Number(r.revenue),
    averageOrderValue:
      Number(r.quantity) > 0
        ? Math.round(Number(r.revenue) / Number(r.quantity))
        : 0,
  }));

  enriched.sort((a, b) => {
    if (sortKey === "revenue") return b.revenue - a.revenue;
    if (sortKey === "avg") return b.averageOrderValue - a.averageOrderValue;
    return b.quantity - a.quantity;
  });

  return enriched.slice(0, limit);
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
      revenue: sql<number>`coalesce(sum(${transactions.total}), 0)::bigint`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.outletId, outletId),
        eq(transactions.status, "paid"),
        gte(transactions.createdAt, fromUtc),
        lt(transactions.createdAt, toUtc),
      ),
    );
  const posRevenue = Number(revRow?.revenue ?? 0);

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

  const totalIncome = posRevenue + manualIncome;
  const grossProfit = totalIncome - expensesTotal;

  return {
    period: { from, to },
    income: { posRevenue, manualIncome, total: totalIncome },
    expenses: { byCategory, total: expensesTotal },
    grossProfit,
    disclaimer:
      "Ini bukan laporan akuntansi resmi. Hanya summary arus kas sederhana.",
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

  const paid = trxs.filter((t) => t.status === "paid");
  const voided = trxs.filter((t) => t.status === "voided");
  const refunded = trxs.filter((t) => t.status === "refunded");

  const revenue = paid.reduce((s, t) => s + t.total, 0);
  const averageTicket =
    paid.length > 0 ? Math.round(revenue / paid.length) : 0;

  const byPaymentMethod: PaymentMethodBreakdown[] = (
    ["cash", "qris", "card_bca"] as const
  ).map((method) => {
    const rows = paid.filter((t) => t.paymentMethod === method);
    return {
      method: method as PaymentMethod,
      count: rows.length,
      amount: rows.reduce((s, t) => s + t.total, 0),
    };
  });

  // Build daily bucket map (WIB day key)
  const wibDateKey = (d: Date) => {
    const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    return `${wib.getUTCFullYear()}-${String(wib.getUTCMonth() + 1).padStart(2, "0")}-${String(wib.getUTCDate()).padStart(2, "0")}`;
  };
  const dayBuckets = new Map<string, { revenue: number; transactionCount: number }>();
  for (const t of paid) {
    const key = wibDateKey(t.createdAt);
    const cur = dayBuckets.get(key) ?? { revenue: 0, transactionCount: 0 };
    cur.revenue += t.total;
    cur.transactionCount += 1;
    dayBuckets.set(key, cur);
  }
  // Fill gaps so charts have continuous time series
  const byDay: SalesRangeReport["byDay"] = [];
  const cursor = new Date(`${from}T00:00:00+07:00`);
  const end = new Date(`${to}T00:00:00+07:00`);
  while (cursor <= end) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    const v = dayBuckets.get(key) ?? { revenue: 0, transactionCount: 0 };
    byDay.push({ date: key, revenue: v.revenue, transactionCount: v.transactionCount });
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
        eq(transactions.status, "paid"),
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
