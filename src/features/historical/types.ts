import type { InferSelectModel } from "drizzle-orm";
import type {
  historicalDailySummary,
  historicalExpense,
} from "@/db/schema";

export type HistoricalDailySummary = InferSelectModel<
  typeof historicalDailySummary
>;

export type HistoricalExpense = InferSelectModel<typeof historicalExpense>;

export interface HistoricalDailySummaryRow extends HistoricalDailySummary {
  /** Computed: gross margin % = (netRevenue - cogs) / netRevenue × 100. Null kalau netRevenue=0. */
  marginPct: number | null;
}

export interface HistoricalExpenseRow extends HistoricalExpense {
  /** Coalesced label: categoryLabel dari master kalau ada, fallback ke categoryLabelLegacy. */
  categoryLabel: string | null;
}

/** Input untuk single create (used kalau owner mau manual entry tanpa CSV). */
export interface CreateHistoricalSummaryInput {
  businessDate: string; // YYYY-MM-DD
  grossRevenue?: number;
  totalRefund?: number;
  totalVoid?: number;
  totalDiscount?: number;
  netRevenue?: number;
  transactionCount?: number;
  cogs?: number;
  cashIn?: number;
  qrisIn?: number;
  edcIn?: number;
  aggregatorIn?: number;
  sourceLabel?: string | null;
  notes?: string | null;
}

export interface UpdateHistoricalSummaryInput
  extends Partial<CreateHistoricalSummaryInput> {
  id: string;
}

/** Input untuk bulk import dari CSV parser output. */
export interface BulkImportSummaryInput {
  rows: Array<{
    businessDate: string;
    grossRevenue: number;
    totalRefund: number;
    totalVoid: number;
    totalDiscount: number;
    netRevenue: number;
    transactionCount: number;
    cogs: number;
    cashIn: number;
    qrisIn: number;
    edcIn: number;
    aggregatorIn: number;
  }>;
  sourceLabel: string;
}

export interface BulkImportResult {
  inserted: number;
  updated: number;
  total: number;
  dateRange: { from: string; to: string };
}

export interface CreateHistoricalExpenseInput {
  businessDate: string;
  categoryId?: string | null;
  categoryLabelLegacy?: string | null;
  amount: number;
  description?: string | null;
  sourceLabel?: string | null;
}

export interface BulkImportExpenseInput {
  rows: CreateHistoricalExpenseInput[];
  sourceLabel: string;
}

export interface ListHistoricalSummaryOptions {
  from?: string; // YYYY-MM-DD inclusive
  to?: string; // YYYY-MM-DD inclusive
  /** Default 200. */
  limit?: number;
}

export interface ListHistoricalExpenseOptions {
  from?: string;
  to?: string;
  categoryId?: string;
  limit?: number;
}

export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

export function ok<T>(data: T): ApiResult<T> {
  return { success: true, data };
}
export function fail(code: string, message: string): ApiResult<never> {
  return { success: false, error: { code, message } };
}
export function isOk<T>(
  res: ApiResult<T>,
): res is { success: true; data: T } {
  return res.success === true;
}
