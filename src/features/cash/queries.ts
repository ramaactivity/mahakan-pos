import "server-only";
import { and, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  expenseCategories,
  expenses,
  incomes,
  transactions,
} from "@/db/schema";
import { endOfWibDateUtc, startOfWibDateUtc } from "./helpers";
import { clampFromDate, getCutoffDate } from "@/features/cutoff/cutoff";
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
  /* Sesi AE-63 phase9 — filter by sourceType supaya Petty Cash POS
   * hanya tampilkan entry MANUAL (gas, ice, galon, tip). Auto-generated
   * expenses dari payroll/purchase/refund di-isolate ke Admin Kas /
   * Akuntansi. Default undefined = semua source (admin behavior). */
  sourceType?:
    | "manual"
    | "purchase"
    | "payroll"
    | "refund"
    /* Sesi AE-198 — boleh beberapa sekaligus. Petty Cash POS perlu
     * manual + purchase: belanja bahan yang dicatat kasir kini jadi
     * PEMBELIAN (sourceType='purchase'), padahal uangnya tetap keluar dari
     * laci yang sama. Tanpa ini kasir tidak melihat entri yang baru saja
     * dia buat, sementara saldo lacinya sudah berkurang. */
    | Array<"manual" | "purchase" | "payroll" | "refund">;
  /* Sesi AE-63 phase9 — filter by paymentMethod. Petty Cash kasir
   * dirancang spesifik untuk CASH DRAWER (laci kasir). Transfer/other
   * tidak affect drawer fisik → exclude dari POS view. */
  paymentMethod?: "cash" | "transfer" | "other";
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
  // Sesi AE-207 — daftar Pengeluaran ikut batas buku.
  const from = clampFromDate(opts.from, await getCutoffDate(outletId));
  if (from) conds.push(gte(expenses.expenseDate, from));
  if (opts.to) conds.push(lte(expenses.expenseDate, opts.to));
  if (opts.categoryId) conds.push(eq(expenses.categoryId, opts.categoryId));
  if (opts.sourceType) {
    conds.push(
      Array.isArray(opts.sourceType)
        ? inArray(expenses.sourceType, opts.sourceType)
        : eq(expenses.sourceType, opts.sourceType),
    );
  }
  if (opts.paymentMethod)
    conds.push(eq(expenses.paymentMethod, opts.paymentMethod));

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
  /* Sesi AE-63 phase9 — parity dengan ListExpensesOptions. Incomes
   * tidak punya sourceType field (selalu manual), tapi paymentMethod
   * relevant: petty cash hanya cash drawer. */
  paymentMethod?: "cash" | "transfer" | "other";
}

export async function fetchIncomes(
  outletId: string,
  opts: ListIncomesOptions = {},
): Promise<Paginated<Income>> {
  const limit = opts.limit ?? 100;
  const conds = [eq(incomes.outletId, outletId), isNull(incomes.deletedAt)];
  // Sesi AE-207 — daftar Pemasukan ikut batas buku.
  const from = clampFromDate(opts.from, await getCutoffDate(outletId));
  if (from) conds.push(gte(incomes.incomeDate, from));
  if (opts.to) conds.push(lte(incomes.incomeDate, opts.to));
  if (opts.paymentMethod)
    conds.push(eq(incomes.paymentMethod, opts.paymentMethod));

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
      refundedAmount: transactions.refundedAmount,
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
    // paid + partially_refunded both contribute revenue (net of partial refund)
    if (t.status === "paid" || t.status === "partially_refunded") {
      const net = t.total - t.refundedAmount;
      if (t.paymentMethod === "cash") posCash += net;
      else if (t.paymentMethod === "qris") posQris += net;
      else posCard += net;
      // Partial refund contribution to refunded totals
      if (t.refundedAmount > 0) {
        refundedTotal += t.refundedAmount;
        // Don't increment refundedCount for partial — only count fully-refunded
      }
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
  /* Sesi AE-49 — split income manual by paymentMethod. Cuma cash yang
   * affect kas drawer (laci kasir). Transfer/other affect bank account. */
  let manualCash = 0;
  let manualCashCount = 0;
  let manualNonCash = 0;
  let manualNonCashCount = 0;
  for (const i of incomeRows) {
    if (i.paymentMethod === "cash") {
      manualCash += i.amount;
      manualCashCount++;
    } else {
      manualNonCash += i.amount;
      manualNonCashCount++;
    }
  }

  const expenseRows = await db
    .select({
      categoryId: expenses.categoryId,
      categoryName: expenseCategories.name,
      amount: expenses.amount,
      paymentMethod: expenses.paymentMethod,
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
  /* Sesi AE-49 — split expenses by paymentMethod (same reasoning as income). */
  let expensesCash = 0;
  let expensesCashCount = 0;
  let expensesNonCash = 0;
  let expensesNonCashCount = 0;
  for (const e of expenseRows) {
    expensesTotal += e.amount;
    if (e.paymentMethod === "cash") {
      expensesCash += e.amount;
      expensesCashCount++;
    } else {
      expensesNonCash += e.amount;
      expensesNonCashCount++;
    }
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
      manual: {
        total: manualTotal,
        count: incomeRows.length,
        cash: manualCash,
        cashCount: manualCashCount,
        nonCash: manualNonCash,
        nonCashCount: manualNonCashCount,
      },
      total: posTotal + manualTotal,
    },
    expenses: {
      byCategory: Array.from(byCategoryMap.values()),
      total: expensesTotal,
      cash: expensesCash,
      cashCount: expensesCashCount,
      nonCash: expensesNonCash,
      nonCashCount: expensesNonCashCount,
    },
    refunds: { count: refundedCount, total: refundedTotal },
    netCashFlow: posTotal + manualTotal - expensesTotal - refundedTotal,
  };
}

// Suppress unused-import warning for sql tag (used by helpers.ts patterns)
export const _q = sql;
