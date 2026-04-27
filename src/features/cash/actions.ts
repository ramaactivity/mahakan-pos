"use server";

import { z } from "zod";
import { db } from "@/db";
import { expenses, incomes } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  fetchDailyCashSummary,
  fetchExpenses,
  fetchExpenseCategories,
  fetchIncomes,
  type ListExpensesOptions,
  type ListIncomesOptions,
} from "./queries";
import { todayWibIso } from "./helpers";
import {
  fail,
  ok,
  type ApiResult,
  type CreateExpenseInput,
  type CreateIncomeInput,
  type DailyCashSummary,
  type Expense,
  type ExpenseCategory,
  type Income,
  type Paginated,
} from "./types";

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus format YYYY-MM-DD");

const createExpenseSchema = z.object({
  expenseDate: isoDateSchema,
  categoryId: z.uuid(),
  description: z.string().trim().min(1).max(200),
  amount: z.number().int().min(1).max(999_999_999),
  paymentMethod: z.enum(["cash", "transfer", "other"]),
  receiptImageUrl: z.string().url().nullable().optional(),
});

const createIncomeSchema = z.object({
  incomeDate: isoDateSchema,
  description: z.string().trim().min(1).max(200),
  amount: z.number().int().min(1).max(999_999_999),
  paymentMethod: z.enum(["cash", "transfer", "other"]),
});

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

// ---------- Reads ----------

export async function listExpenses(
  opts: ListExpensesOptions = {},
): Promise<ApiResult<Paginated<Expense>>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "cash.daily_summary.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat pengeluaran");
  }
  return ok(await fetchExpenses(session.user.outletId, opts));
}

export async function listExpenseCategories(): Promise<
  ApiResult<Paginated<ExpenseCategory>>
> {
  const session = await requireSession();
  return ok(await fetchExpenseCategories(session.user.outletId));
}

export async function listIncomes(
  opts: ListIncomesOptions = {},
): Promise<ApiResult<Paginated<Income>>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "cash.daily_summary.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat pemasukan");
  }
  return ok(await fetchIncomes(session.user.outletId, opts));
}

export async function getDailyCashSummary(
  date: string = todayWibIso(),
): Promise<ApiResult<DailyCashSummary>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "cash.daily_summary.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat ringkasan kas");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return fail("VALIDATION_ERROR", "Tanggal tidak valid");
  }
  return ok(await fetchDailyCashSummary(session.user.outletId, date));
}

// ---------- Mutations ----------

export async function createExpense(
  input: CreateExpenseInput,
): Promise<ApiResult<Expense>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "expense.create")) {
    return fail("FORBIDDEN", "Tidak punya hak buat pengeluaran");
  }

  const parsed = createExpenseSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  const [row] = await db
    .insert(expenses)
    .values({
      outletId: session.user.outletId,
      expenseDate: v.expenseDate,
      categoryId: v.categoryId,
      description: v.description,
      amount: v.amount,
      paymentMethod: v.paymentMethod,
      receiptImageUrl: v.receiptImageUrl ?? null,
      createdBy: session.user.id,
    })
    .returning();

  await logAudit({
    eventType: "expense.create",
    userId: session.user.id,
    entityType: "expense",
    entityId: row.id,
    payload: {
      summary: `Pengeluaran Rp${row.amount.toLocaleString("id-ID")} — ${row.description}`,
      after: {
        date: row.expenseDate,
        amount: row.amount,
        description: row.description,
        method: row.paymentMethod,
      },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok(row);
}

export async function createIncome(
  input: CreateIncomeInput,
): Promise<ApiResult<Income>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "income.create")) {
    return fail("FORBIDDEN", "Tidak punya hak buat pemasukan");
  }

  const parsed = createIncomeSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  const [row] = await db
    .insert(incomes)
    .values({
      outletId: session.user.outletId,
      incomeDate: v.incomeDate,
      description: v.description,
      amount: v.amount,
      paymentMethod: v.paymentMethod,
      createdBy: session.user.id,
    })
    .returning();

  await logAudit({
    eventType: "income.create",
    userId: session.user.id,
    entityType: "income",
    entityId: row.id,
    payload: {
      summary: `Pemasukan Rp${row.amount.toLocaleString("id-ID")} — ${row.description}`,
      after: {
        date: row.incomeDate,
        amount: row.amount,
        description: row.description,
        method: row.paymentMethod,
      },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok(row);
}
