import "server-only";
import { and, desc, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  expenseCategories,
  expenses,
  incomes,
  transactions,
} from "@/db/schema";
import { endOfWibDateUtc, startOfWibDateUtc } from "./helpers";
import type {
  DailyCashSummary,
  Expense,
  ExpenseCategory,
  Income,
  Paginated,
} from "./types";

export interface ListExpensesOptions {
  from?: string;
  to?: string;
  categoryId?: string;
  limit?: number;
}

export async function fetchExpenses(
  outletId: string,
  opts: ListExpensesOptions = {},
): Promise<Paginated<Expense>> {
  const limit = opts.limit ?? 100;
  const conds = [
    eq(expenses.outletId, outletId),
    isNull(expenses.deletedAt),
  ];
  if (opts.from) conds.push(gte(expenses.expenseDate, opts.from));
  if (opts.to) conds.push(lte(expenses.expenseDate, opts.to));
  if (opts.categoryId) conds.push(eq(expenses.categoryId, opts.categoryId));

  const rows = await db
    .select()
    .from(expenses)
    .where(and(...conds))
    .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  return {
    items: hasMore ? rows.slice(0, limit) : rows,
    total: rows.length,
    hasMore,
  };
}

export async function fetchExpenseCategories(
  outletId: string,
): Promise<Paginated<ExpenseCategory>> {
  const rows = await db
    .select()
    .from(expenseCategories)
    .where(
      and(
        eq(expenseCategories.outletId, outletId),
        isNull(expenseCategories.deletedAt),
      ),
    )
    .orderBy(expenseCategories.displayOrder, expenseCategories.name);
  return { items: rows, total: rows.length };
}

export interface ListIncomesOptions {
  from?: string;
  to?: string;
  limit?: number;
}

export async function fetchIncomes(
  outletId: string,
  opts: ListIncomesOptions = {},
): Promise<Paginated<Income>> {
  const limit = opts.limit ?? 100;
  const conds = [eq(incomes.outletId, outletId), isNull(incomes.deletedAt)];
  if (opts.from) conds.push(gte(incomes.incomeDate, opts.from));
  if (opts.to) conds.push(lte(incomes.incomeDate, opts.to));

  const rows = await db
    .select()
    .from(incomes)
    .where(and(...conds))
    .orderBy(desc(incomes.incomeDate), desc(incomes.createdAt))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  return {
    items: hasMore ? rows.slice(0, limit) : rows,
    total: rows.length,
    hasMore,
  };
}

export async function fetchDailyCashSummary(
  outletId: string,
  date: string,
): Promise<DailyCashSummary> {
  const dayStart = startOfWibDateUtc(date);
  const dayEnd = endOfWibDateUtc(date);

  const trxRows = await db
    .select({
      status: transactions.status,
      paymentMethod: transactions.paymentMethod,
      total: transactions.total,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.outletId, outletId),
        gte(transactions.createdAt, dayStart),
        lt(transactions.createdAt, dayEnd),
      ),
    );

  let posCash = 0;
  let posQris = 0;
  let posCard = 0;
  let refundedCount = 0;
  let refundedTotal = 0;
  for (const t of trxRows) {
    if (t.status === "paid") {
      if (t.paymentMethod === "cash") posCash += t.total;
      else if (t.paymentMethod === "qris") posQris += t.total;
      else posCard += t.total;
    } else if (t.status === "refunded") {
      refundedCount += 1;
      refundedTotal += t.total;
    }
  }
  const posTotal = posCash + posQris + posCard;

  const incomeRows = await db
    .select()
    .from(incomes)
    .where(
      and(
        eq(incomes.outletId, outletId),
        eq(incomes.incomeDate, date),
        isNull(incomes.deletedAt),
      ),
    );
  const manualTotal = incomeRows.reduce((s, i) => s + i.amount, 0);

  const expenseRows = await db
    .select({
      categoryId: expenses.categoryId,
      categoryName: expenseCategories.name,
      amount: expenses.amount,
    })
    .from(expenses)
    .innerJoin(
      expenseCategories,
      eq(expenseCategories.id, expenses.categoryId),
    )
    .where(
      and(
        eq(expenses.outletId, outletId),
        eq(expenses.expenseDate, date),
        isNull(expenses.deletedAt),
      ),
    );

  const byCategoryMap = new Map<
    string,
    { categoryId: string; name: string; total: number; count: number }
  >();
  let expensesTotal = 0;
  for (const e of expenseRows) {
    expensesTotal += e.amount;
    const existing = byCategoryMap.get(e.categoryId);
    if (existing) {
      existing.total += e.amount;
      existing.count += 1;
    } else {
      byCategoryMap.set(e.categoryId, {
        categoryId: e.categoryId,
        name: e.categoryName,
        total: e.amount,
        count: 1,
      });
    }
  }

  return {
    date,
    income: {
      pos: { cash: posCash, qris: posQris, cardBca: posCard, total: posTotal },
      manual: { total: manualTotal, count: incomeRows.length },
      total: posTotal + manualTotal,
    },
    expenses: {
      byCategory: Array.from(byCategoryMap.values()),
      total: expensesTotal,
    },
    refunds: { count: refundedCount, total: refundedTotal },
    netCashFlow: posTotal + manualTotal - expensesTotal - refundedTotal,
  };
}

// Suppress unused-import warning for sql tag (used by helpers.ts patterns)
export const _q = sql;
