import type { InferSelectModel } from "drizzle-orm";
import type { expenseCategories, expenses, incomes } from "@/db/schema";

export type ExpenseCategory = InferSelectModel<typeof expenseCategories>;
export type Expense = InferSelectModel<typeof expenses>;
export type Income = InferSelectModel<typeof incomes>;

export type CashPaymentMethod = "cash" | "transfer" | "other";

export type ApiResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: { code: string; message: string; field?: string };
    };

export interface Paginated<T> {
  items: T[];
  total: number;
  hasMore?: boolean;
}

export function ok<T>(data: T): ApiResult<T> {
  return { success: true, data };
}

export function fail(
  code: string,
  message: string,
  field?: string,
): ApiResult<never> {
  return { success: false, error: { code, message, field } };
}

export function isOk<T>(
  res: ApiResult<T>,
): res is { success: true; data: T } {
  return res.success === true;
}

export interface CreateExpenseInput {
  expenseDate: string; // YYYY-MM-DD
  categoryId: string;
  description: string;
  amount: number;
  paymentMethod: CashPaymentMethod;
  /** Phase 1: skipped — receipt photo upload deferred per C3=C. */
  receiptImageUrl?: string | null;
  /** Sesi AE-69 — optional bank account FK (untuk transfer/other). NULL
   * = fallback ke hardcoded mapping (transfer→1110, other→1112). */
  bankAccountId?: string | null;
}

export interface CreateIncomeInput {
  incomeDate: string;
  description: string;
  amount: number;
  paymentMethod: CashPaymentMethod;
  /** Sesi AE-69 — optional bank account FK. */
  bankAccountId?: string | null;
  /** Sesi AE-71 — optional revenue account FK. NULL = default 4201
   * Pendapatan Lain-lain. Owner pilih per entry untuk granular reporting
   * (Sewa Ruang vs Titip Jual vs Lain di P&L). */
  accountId?: string | null;
}

export interface DailyCashSummary {
  date: string;
  income: {
    pos: { cash: number; qris: number; cardBca: number; total: number };
    manual: {
      total: number;
      count: number;
      /** Sesi AE-49 — breakdown by payment method. Cash only affect kas drawer
       * fisik (laci kasir); transfer/other affect bank account, bukan kas. */
      cash: number;
      cashCount: number;
      nonCash: number;
      nonCashCount: number;
    };
    total: number;
  };
  expenses: {
    byCategory: Array<{
      categoryId: string;
      name: string;
      total: number;
      count: number;
    }>;
    total: number;
    /** Sesi AE-49 — breakdown by payment method. Cuma cash yang dikurangi
     * dari Kas Harusnya saat tutup shift. Transfer/other tampil terpisah
     * di modal sebagai info (tidak affect drawer fisik). */
    cash: number;
    cashCount: number;
    nonCash: number;
    nonCashCount: number;
  };
  refunds: { count: number; total: number };
  netCashFlow: number;
}
