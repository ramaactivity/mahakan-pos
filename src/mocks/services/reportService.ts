import type { ApiResult, PaymentMethod } from "../types";
import { delay, ok, todayInJakarta } from "./_helpers";
import { _internalAllTransactions } from "./transactionService";
import {
  listExpenses,
  listIncomes,
  listExpenseCategories,
} from "./expenseService";

// --------------------------------------------------------------------------
// Daily sales report (per docs/08-API-SPEC.md §7.1)
// --------------------------------------------------------------------------

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

export async function getDailySalesReport(
  date: string = todayInJakarta(),
): Promise<ApiResult<DailySalesReport>> {
  await delay();

  const all = _internalAllTransactions().filter(
    (t) => t.createdAt.slice(0, 10) === date,
  );
  const paid = all.filter((t) => t.status === "paid");
  const voided = all.filter((t) => t.status === "voided");
  const refunded = all.filter((t) => t.status === "refunded");

  const revenue = paid.reduce((s, t) => s + t.total, 0);
  const averageTicket = paid.length > 0 ? Math.round(revenue / paid.length) : 0;

  const byPaymentMethod: PaymentMethodBreakdown[] = (
    ["cash", "qris", "card_bca"] as const
  ).map((method) => {
    const rows = paid.filter((t) => t.paymentMethod === method);
    return {
      method,
      count: rows.length,
      amount: rows.reduce((s, t) => s + t.total, 0),
    };
  });

  // Group items by category
  const categoryMap = new Map<string, CategoryBreakdown>();
  for (const trx of paid) {
    for (const item of trx.items) {
      const current = categoryMap.get(item.itemCategoryName) ?? {
        categoryName: item.itemCategoryName,
        count: 0,
        revenue: 0,
      };
      current.count += item.quantity;
      current.revenue += item.subtotal;
      categoryMap.set(item.itemCategoryName, current);
    }
  }
  const byCategory = [...categoryMap.values()].sort(
    (a, b) => b.revenue - a.revenue,
  );

  // Top items
  const itemMap = new Map<string, TopItem>();
  for (const trx of paid) {
    for (const item of trx.items) {
      const current = itemMap.get(item.menuItemId) ?? {
        menuItemId: item.menuItemId,
        name: item.itemName,
        quantity: 0,
        revenue: 0,
      };
      current.quantity += item.quantity;
      current.revenue += item.subtotal;
      itemMap.set(item.menuItemId, current);
    }
  }
  const topItems = [...itemMap.values()]
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10);

  // Hourly distribution (WIB)
  const hourlyMap = new Map<number, HourlyBucket>();
  for (const trx of paid) {
    const utc = new Date(trx.createdAt);
    const wib = new Date(utc.getTime() + 7 * 60 * 60 * 1000);
    const hour = wib.getUTCHours();
    const current = hourlyMap.get(hour) ?? { hour, count: 0, revenue: 0 };
    current.count += 1;
    current.revenue += trx.total;
    hourlyMap.set(hour, current);
  }
  const hourlyDistribution = [...hourlyMap.values()].sort(
    (a, b) => a.hour - b.hour,
  );

  return ok({
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
  });
}

// --------------------------------------------------------------------------
// Range sales report (per docs/08-API-SPEC.md §7.2)
// --------------------------------------------------------------------------

export type RangeGroupBy = "day" | "week" | "month";

export interface RangeSalesReport {
  period: { from: string; to: string };
  totals: {
    revenue: number;
    transactionCount: number;
    averageTicket: number;
  };
  series: Array<{ bucket: string; revenue: number; count: number }>;
  byPaymentMethod: PaymentMethodBreakdown[];
}

export async function getRangeSalesReport(
  from: string,
  to: string,
  groupBy: RangeGroupBy = "day",
): Promise<ApiResult<RangeSalesReport>> {
  await delay();

  const paid = _internalAllTransactions().filter((t) => {
    const day = t.createdAt.slice(0, 10);
    return t.status === "paid" && day >= from && day <= to;
  });

  const revenue = paid.reduce((s, t) => s + t.total, 0);
  const averageTicket = paid.length > 0 ? Math.round(revenue / paid.length) : 0;

  const bucketOf = (iso: string): string => {
    if (groupBy === "day") return iso.slice(0, 10);
    if (groupBy === "month") return iso.slice(0, 7);
    // week — ISO week bucket simplified to YYYY-Www based on Jan-1 anchor
    const d = new Date(iso);
    const jan1 = new Date(d.getUTCFullYear(), 0, 1);
    const week = Math.ceil(
      ((d.getTime() - jan1.getTime()) / (86_400_000) + jan1.getUTCDay() + 1) / 7,
    );
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  };

  const seriesMap = new Map<string, { bucket: string; revenue: number; count: number }>();
  for (const t of paid) {
    const bucket = bucketOf(t.createdAt);
    const current = seriesMap.get(bucket) ?? { bucket, revenue: 0, count: 0 };
    current.revenue += t.total;
    current.count += 1;
    seriesMap.set(bucket, current);
  }
  const series = [...seriesMap.values()].sort((a, b) =>
    a.bucket < b.bucket ? -1 : 1,
  );

  const byPaymentMethod: PaymentMethodBreakdown[] = (
    ["cash", "qris", "card_bca"] as const
  ).map((method) => {
    const rows = paid.filter((t) => t.paymentMethod === method);
    return {
      method,
      count: rows.length,
      amount: rows.reduce((s, t) => s + t.total, 0),
    };
  });

  return ok({
    period: { from, to },
    totals: { revenue, transactionCount: paid.length, averageTicket },
    series,
    byPaymentMethod,
  });
}

// --------------------------------------------------------------------------
// Item performance (per docs/08-API-SPEC.md §7.3)
// --------------------------------------------------------------------------

export interface ItemPerformanceRow {
  menuItemId: string;
  name: string;
  categoryName: string;
  quantity: number;
  revenue: number;
  averageOrderValue: number;
}

export async function getItemPerformance(
  from: string,
  to: string,
  sort: "qty" | "revenue" | "avg" = "qty",
  limit = 100,
): Promise<ApiResult<ItemPerformanceRow[]>> {
  await delay();

  const paid = _internalAllTransactions().filter((t) => {
    const day = t.createdAt.slice(0, 10);
    return t.status === "paid" && day >= from && day <= to;
  });

  const map = new Map<string, ItemPerformanceRow>();
  for (const trx of paid) {
    for (const item of trx.items) {
      const current = map.get(item.menuItemId) ?? {
        menuItemId: item.menuItemId,
        name: item.itemName,
        categoryName: item.itemCategoryName,
        quantity: 0,
        revenue: 0,
        averageOrderValue: 0,
      };
      current.quantity += item.quantity;
      current.revenue += item.subtotal;
      map.set(item.menuItemId, current);
    }
  }

  const rows = [...map.values()].map((r) => ({
    ...r,
    averageOrderValue: r.quantity > 0 ? Math.round(r.revenue / r.quantity) : 0,
  }));

  rows.sort((a, b) => {
    if (sort === "revenue") return b.revenue - a.revenue;
    if (sort === "avg") return b.averageOrderValue - a.averageOrderValue;
    return b.quantity - a.quantity;
  });

  return ok(rows.slice(0, limit));
}

// --------------------------------------------------------------------------
// Simple P&L (Owner only — per docs/08-API-SPEC.md §7.4)
// --------------------------------------------------------------------------

export interface PnlReport {
  period: { from: string; to: string };
  income: {
    posRevenue: number;
    manualIncome: number;
    total: number;
  };
  expenses: {
    byCategory: Array<{ name: string; amount: number }>;
    total: number;
  };
  grossProfit: number;
  disclaimer: string;
}

export async function getPnlReport(
  from: string,
  to: string,
): Promise<ApiResult<PnlReport>> {
  await delay();

  const posRevenue = _internalAllTransactions()
    .filter((t) => {
      const day = t.createdAt.slice(0, 10);
      return t.status === "paid" && day >= from && day <= to;
    })
    .reduce((s, t) => s + t.total, 0);

  const incomesRes = await listIncomes({ from, to, limit: 1000 });
  const manualIncome = incomesRes.success
    ? incomesRes.data.items.reduce((s, i) => s + i.amount, 0)
    : 0;

  const expensesRes = await listExpenses({ from, to, limit: 1000 });
  const categoriesRes = await listExpenseCategories();

  const byCategory: Array<{ name: string; amount: number }> = [];
  let expensesTotal = 0;
  if (expensesRes.success && categoriesRes.success) {
    for (const cat of categoriesRes.data.items) {
      const rows = expensesRes.data.items.filter(
        (e) => e.categoryId === cat.id,
      );
      const amount = rows.reduce((s, e) => s + e.amount, 0);
      if (amount > 0) {
        byCategory.push({ name: cat.name, amount });
        expensesTotal += amount;
      }
    }
  }

  const income = posRevenue + manualIncome;
  const grossProfit = income - expensesTotal;

  return ok({
    period: { from, to },
    income: { posRevenue, manualIncome, total: income },
    expenses: { byCategory, total: expensesTotal },
    grossProfit,
    disclaimer:
      "Ini bukan laporan akuntansi resmi. Hanya summary arus kas sederhana.",
  });
}

// --------------------------------------------------------------------------
// Shift report with variance flags (per docs/08-API-SPEC.md §7.5)
// --------------------------------------------------------------------------

const VARIANCE_ALERT_THRESHOLD = 10_000; // matches mockOutlet.settings.thresholds

export interface ShiftReportRow {
  shiftId: string;
  userId: string;
  openedAt: string;
  closedAt: string | null;
  openingCash: number;
  actualCash: number | null;
  variance: number | null;
  transactionCount: number;
  revenue: number;
  /** True if abs(variance) exceeds threshold — flag for review. */
  hasVariance: boolean;
}

export interface ListShiftReportOptions {
  from?: string;
  to?: string;
  userId?: string;
  hasVariance?: boolean;
}

export async function listShiftReport(
  options: ListShiftReportOptions = {},
): Promise<ApiResult<ShiftReportRow[]>> {
  await delay();

  // Import lazily to break potential load-order issues
  const { listShifts } = await import("./shiftService");
  const shiftsRes = await listShifts({
    from: options.from,
    to: options.to,
    userId: options.userId,
    limit: 1000,
  });
  if (!shiftsRes.success) return shiftsRes;

  const trxs = _internalAllTransactions();

  const rows: ShiftReportRow[] = shiftsRes.data.items.map((s) => {
    const shiftTrxs = trxs.filter(
      (t) => t.shiftId === s.id && t.status === "paid",
    );
    const revenue = shiftTrxs.reduce((sum, t) => sum + t.total, 0);
    const hasVariance =
      s.variance !== null && Math.abs(s.variance) > VARIANCE_ALERT_THRESHOLD;
    return {
      shiftId: s.id,
      userId: s.userId,
      openedAt: s.openedAt,
      closedAt: s.closedAt,
      openingCash: s.openingCash,
      actualCash: s.actualCash,
      variance: s.variance,
      transactionCount: shiftTrxs.length,
      revenue,
      hasVariance,
    };
  });

  const filtered = options.hasVariance
    ? rows.filter((r) => r.hasVariance)
    : rows;

  return ok(filtered);
}
