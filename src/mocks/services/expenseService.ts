import {
  OUTLET_ID,
  mockExpenseCategories,
  mockExpenses,
  mockIncomes,
} from "../data";
import type {
  ApiResult,
  Expense,
  ExpenseCategory,
  ExpensePaymentMethod,
  Income,
  Paginated,
} from "../types";
import { delay, fail, genId, ok, todayInJakarta } from "./_helpers";
import { _internalAllTransactions } from "./transactionService";

let expenses: Expense[] = mockExpenses.map((e) => ({ ...e }));
let incomes: Income[] = mockIncomes.map((i) => ({ ...i }));
const expenseCategories: ExpenseCategory[] = mockExpenseCategories.map((c) => ({
  ...c,
}));

// --------------------------------------------------------------------------
// Expense
// --------------------------------------------------------------------------

export interface CreateExpenseInput {
  expenseDate: string; // YYYY-MM-DD
  categoryId: string;
  description: string;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  receiptImageUrl: string | null;
  createdBy: string;
}

export async function createExpense(
  input: CreateExpenseInput,
): Promise<ApiResult<Expense>> {
  await delay();
  if (input.amount < 1) {
    return fail("VALIDATION_ERROR", "Nominal pengeluaran minimal Rp 1", "amount");
  }
  const cat = expenseCategories.find(
    (c) => c.id === input.categoryId && c.deletedAt === null,
  );
  if (!cat) return fail("NOT_FOUND", "Kategori tidak ditemukan", "categoryId");

  const now = new Date().toISOString();
  const newExpense: Expense = {
    id: genId("exp"),
    outletId: OUTLET_ID,
    expenseDate: input.expenseDate,
    categoryId: input.categoryId,
    description: input.description,
    amount: input.amount,
    paymentMethod: input.paymentMethod,
    receiptImageUrl: input.receiptImageUrl,
    refundedTransactionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdBy: input.createdBy,
    updatedBy: null,
    deletedBy: null,
  };
  expenses = [...expenses, newExpense];
  return ok(newExpense);
}

export interface ListExpenseOptions {
  from?: string; // YYYY-MM-DD
  to?: string;
  categoryId?: string;
  paymentMethod?: ExpensePaymentMethod;
  limit?: number;
}

export async function listExpenses(
  options: ListExpenseOptions = {},
): Promise<ApiResult<Paginated<Expense>>> {
  await delay();
  const { from, to, categoryId, paymentMethod, limit = 50 } = options;
  const filtered = expenses.filter((e) => {
    if (e.deletedAt !== null) return false;
    if (from && e.expenseDate < from) return false;
    if (to && e.expenseDate > to) return false;
    if (categoryId && e.categoryId !== categoryId) return false;
    if (paymentMethod && e.paymentMethod !== paymentMethod) return false;
    return true;
  });
  filtered.sort((a, b) => (a.expenseDate < b.expenseDate ? 1 : -1));
  return ok({
    items: filtered.slice(0, limit),
    total: filtered.length,
    hasMore: filtered.length > limit,
  });
}

export async function listExpenseCategories(): Promise<
  ApiResult<Paginated<ExpenseCategory>>
> {
  await delay();
  const active = expenseCategories.filter((c) => c.deletedAt === null);
  active.sort((a, b) => a.displayOrder - b.displayOrder);
  return ok({ items: active, total: active.length });
}

// --------------------------------------------------------------------------
// Income
// --------------------------------------------------------------------------

export interface CreateIncomeInput {
  incomeDate: string;
  description: string;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  createdBy: string;
}

export async function createIncome(
  input: CreateIncomeInput,
): Promise<ApiResult<Income>> {
  await delay();
  if (input.amount < 1) {
    return fail("VALIDATION_ERROR", "Nominal pemasukan minimal Rp 1", "amount");
  }
  const now = new Date().toISOString();
  const newIncome: Income = {
    id: genId("inc"),
    outletId: OUTLET_ID,
    incomeDate: input.incomeDate,
    description: input.description,
    amount: input.amount,
    paymentMethod: input.paymentMethod,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdBy: input.createdBy,
    updatedBy: null,
  };
  incomes = [...incomes, newIncome];
  return ok(newIncome);
}

export interface ListIncomeOptions {
  from?: string;
  to?: string;
  limit?: number;
}

export async function listIncomes(
  options: ListIncomeOptions = {},
): Promise<ApiResult<Paginated<Income>>> {
  await delay();
  const { from, to, limit = 50 } = options;
  const filtered = incomes.filter((i) => {
    if (i.deletedAt !== null) return false;
    if (from && i.incomeDate < from) return false;
    if (to && i.incomeDate > to) return false;
    return true;
  });
  filtered.sort((a, b) => (a.incomeDate < b.incomeDate ? 1 : -1));
  return ok({
    items: filtered.slice(0, limit),
    total: filtered.length,
    hasMore: filtered.length > limit,
  });
}

// --------------------------------------------------------------------------
// Daily cash summary (per docs/08-API-SPEC.md §6.7)
// --------------------------------------------------------------------------

export interface DailyCashSummary {
  date: string;
  income: {
    pos: { cash: number; qris: number; cardBca: number; total: number };
    manual: { total: number; count: number };
    total: number;
  };
  expenses: {
    byCategory: Array<{ categoryId: string; name: string; total: number; count: number }>;
    total: number;
  };
  refunds: { count: number; total: number };
  netCashFlow: number;
}

export async function getDailyCashSummary(
  date: string = todayInJakarta(),
): Promise<ApiResult<DailyCashSummary>> {
  await delay();

  const trxsToday = _internalAllTransactions().filter(
    (t) => t.createdAt.slice(0, 10) === date,
  );
  const paid = trxsToday.filter((t) => t.status === "paid");
  const refunded = trxsToday.filter((t) => t.status === "refunded");

  const posCash = paid
    .filter((t) => t.paymentMethod === "cash")
    .reduce((s, t) => s + t.total, 0);
  const posQris = paid
    .filter((t) => t.paymentMethod === "qris")
    .reduce((s, t) => s + t.total, 0);
  const posCard = paid
    .filter((t) => t.paymentMethod === "card_bca")
    .reduce((s, t) => s + t.total, 0);

  const incomesToday = incomes.filter(
    (i) => i.deletedAt === null && i.incomeDate === date,
  );
  const manualTotal = incomesToday.reduce((s, i) => s + i.amount, 0);

  const expensesToday = expenses.filter(
    (e) => e.deletedAt === null && e.expenseDate === date,
  );
  const byCategory = expenseCategories
    .map((cat) => {
      const rows = expensesToday.filter((e) => e.categoryId === cat.id);
      return {
        categoryId: cat.id,
        name: cat.name,
        total: rows.reduce((s, e) => s + e.amount, 0),
        count: rows.length,
      };
    })
    .filter((c) => c.count > 0);

  const expensesTotal = expensesToday.reduce((s, e) => s + e.amount, 0);
  const refundsTotal = refunded.reduce((s, t) => s + t.total, 0);

  const summary: DailyCashSummary = {
    date,
    income: {
      pos: {
        cash: posCash,
        qris: posQris,
        cardBca: posCard,
        total: posCash + posQris + posCard,
      },
      manual: { total: manualTotal, count: incomesToday.length },
      total: posCash + posQris + posCard + manualTotal,
    },
    expenses: { byCategory, total: expensesTotal },
    refunds: { count: refunded.length, total: refundsTotal },
    netCashFlow:
      posCash + posQris + posCard + manualTotal - expensesTotal - refundsTotal,
  };

  return ok(summary);
}

// --------------------------------------------------------------------------
// Internal: called by transactionService.refundTransaction to auto-create expense
// --------------------------------------------------------------------------

export interface InternalAddRefundInput {
  refundedTransactionId: string;
  transactionNumber: string;
  reason: string;
  amount: number;
  createdBy: string;
  categoryId: string;
}

export function _internalAddRefundExpense(
  input: InternalAddRefundInput,
): Expense {
  const now = new Date().toISOString();
  const exp: Expense = {
    id: genId("exp"),
    outletId: OUTLET_ID,
    expenseDate: todayInJakarta(),
    categoryId: input.categoryId,
    description: `Refund ${input.transactionNumber}: ${input.reason}`,
    amount: input.amount,
    paymentMethod: "cash",
    receiptImageUrl: null,
    refundedTransactionId: input.refundedTransactionId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdBy: input.createdBy,
    updatedBy: null,
    deletedBy: null,
  };
  expenses = [...expenses, exp];
  return exp;
}

export function __resetExpenseState(): void {
  expenses = mockExpenses.map((e) => ({ ...e }));
  incomes = mockIncomes.map((i) => ({ ...i }));
}
