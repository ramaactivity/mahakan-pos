import type { PaymentMethod } from "@/features/transactions";

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
}

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
