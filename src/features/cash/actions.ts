"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { expenseCategories, expenses, incomes } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { diffShallow, logAudit } from "@/lib/audit";
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

// ---------- Expense update / delete ----------

const updateExpenseSchema = z.object({
  expenseDate: isoDateSchema.optional(),
  categoryId: z.uuid().optional(),
  description: z.string().trim().min(1).max(200).optional(),
  amount: z.number().int().min(1).max(999_999_999).optional(),
  paymentMethod: z.enum(["cash", "transfer", "other"]).optional(),
});

export type UpdateExpenseInput = z.input<typeof updateExpenseSchema>;

export async function updateExpense(
  id: string,
  input: UpdateExpenseInput,
): Promise<ApiResult<Expense>> {
  const session = await requireSession();
  // Owner can edit anytime; Manager only within 24h.
  const [current] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, id), isNull(expenses.deletedAt)))
    .limit(1);
  if (!current) return fail("NOT_FOUND", "Pengeluaran tidak ditemukan");
  if (current.refundedTransactionId) {
    return fail(
      "BUSINESS_RULE_VIOLATION",
      "Refund auto tidak bisa di-edit manual",
    );
  }

  const ageMs = Date.now() - current.createdAt.getTime();
  const within24h = ageMs <= 24 * 60 * 60 * 1000;
  const canEdit = hasPermission(session.user.role, "expense.update_anytime")
    || (within24h && hasPermission(session.user.role, "expense.update_within_24h"));
  if (!canEdit) {
    return fail(
      "FORBIDDEN",
      within24h
        ? "Tidak punya hak edit pengeluaran"
        : "Manager hanya bisa edit pengeluaran ≤ 24 jam",
    );
  }

  const parsed = updateExpenseSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }
  const v = parsed.data;

  const updates: Partial<typeof expenses.$inferInsert> = {
    updatedAt: new Date(),
    updatedBy: session.user.id,
  };
  if (v.expenseDate) updates.expenseDate = v.expenseDate;
  if (v.categoryId) updates.categoryId = v.categoryId;
  if (v.description) updates.description = v.description;
  if (v.amount) updates.amount = v.amount;
  if (v.paymentMethod) updates.paymentMethod = v.paymentMethod;

  const [row] = await db
    .update(expenses)
    .set(updates)
    .where(eq(expenses.id, id))
    .returning();

  const beforeSnap = {
    expenseDate: current.expenseDate,
    categoryId: current.categoryId,
    description: current.description,
    amount: current.amount,
    paymentMethod: current.paymentMethod,
  };
  const afterSnap = {
    expenseDate: row.expenseDate,
    categoryId: row.categoryId,
    description: row.description,
    amount: row.amount,
    paymentMethod: row.paymentMethod,
  };
  const diff = diffShallow(beforeSnap, afterSnap);
  if (diff) {
    await logAudit({
      eventType: "expense.update",
      userId: session.user.id,
      entityType: "expense",
      entityId: row.id,
      payload: {
        summary: `Edit pengeluaran "${row.description}"`,
        before: beforeSnap,
        after: afterSnap,
        diff,
      },
      metadata: { outletId: session.user.outletId, actorRole: session.user.role },
    });
  }

  return ok(row);
}

export async function deleteExpense(id: string): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "expense.delete")) {
    return fail("FORBIDDEN", "Hapus pengeluaran hanya untuk Owner");
  }

  const [current] = await db
    .select({
      id: expenses.id,
      description: expenses.description,
      amount: expenses.amount,
      refundedTransactionId: expenses.refundedTransactionId,
    })
    .from(expenses)
    .where(and(eq(expenses.id, id), isNull(expenses.deletedAt)))
    .limit(1);
  if (!current) return fail("NOT_FOUND", "Pengeluaran tidak ditemukan");
  if (current.refundedTransactionId) {
    return fail(
      "BUSINESS_RULE_VIOLATION",
      "Refund auto tidak bisa di-hapus manual",
    );
  }

  const [row] = await db
    .update(expenses)
    .set({
      deletedAt: new Date(),
      deletedBy: session.user.id,
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(eq(expenses.id, id))
    .returning({ id: expenses.id });

  await logAudit({
    eventType: "expense.delete",
    userId: session.user.id,
    entityType: "expense",
    entityId: row.id,
    payload: {
      summary: `Hapus pengeluaran Rp${current.amount.toLocaleString("id-ID")} — ${current.description}`,
      before: { description: current.description, amount: current.amount },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok({ id: row.id });
}

// ---------- Expense Category CRUD ----------

const categoryNameSchema = z.string().trim().min(1).max(60);

export async function createExpenseCategory(
  name: string,
): Promise<ApiResult<ExpenseCategory>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "expense.category.create")) {
    return fail("FORBIDDEN", "Tidak punya hak buat kategori");
  }
  const parsed = categoryNameSchema.safeParse(name);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }

  const [{ maxOrder }] = await db
    .select({
      maxOrder: sql<number>`coalesce(max(${expenseCategories.displayOrder}), 0)::int`,
    })
    .from(expenseCategories)
    .where(eq(expenseCategories.outletId, session.user.outletId));

  try {
    const [row] = await db
      .insert(expenseCategories)
      .values({
        outletId: session.user.outletId,
        name: parsed.data,
        displayOrder: maxOrder + 1,
      })
      .returning();

    await logAudit({
      eventType: "expense_category.create",
      userId: session.user.id,
      entityType: "expense_category",
      entityId: row.id,
      payload: { summary: `Tambah kategori expense "${row.name}"` },
      metadata: { outletId: session.user.outletId, actorRole: session.user.role },
    });

    return ok(row);
  } catch (e) {
    if (e instanceof Error && /unique|duplicate/i.test(e.message)) {
      return fail("DUPLICATE", "Nama kategori sudah ada");
    }
    return fail("DB_ERROR", e instanceof Error ? e.message : "DB error");
  }
}

export async function updateExpenseCategory(
  id: string,
  name: string,
): Promise<ApiResult<ExpenseCategory>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "expense.category.update")) {
    return fail("FORBIDDEN", "Tidak punya hak edit kategori");
  }
  const parsed = categoryNameSchema.safeParse(name);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }

  const [before] = await db
    .select()
    .from(expenseCategories)
    .where(and(eq(expenseCategories.id, id), isNull(expenseCategories.deletedAt)))
    .limit(1);
  if (!before) return fail("NOT_FOUND", "Kategori tidak ditemukan");
  if (before.isSystem) {
    return fail("BUSINESS_RULE_VIOLATION", "Kategori sistem tidak bisa di-rename");
  }

  try {
    const [row] = await db
      .update(expenseCategories)
      .set({ name: parsed.data, updatedAt: new Date() })
      .where(eq(expenseCategories.id, id))
      .returning();

    if (before.name !== row.name) {
      await logAudit({
        eventType: "expense_category.update",
        userId: session.user.id,
        entityType: "expense_category",
        entityId: row.id,
        payload: {
          summary: `Rename kategori "${before.name}" → "${row.name}"`,
          before: { name: before.name },
          after: { name: row.name },
        },
        metadata: { outletId: session.user.outletId, actorRole: session.user.role },
      });
    }

    return ok(row);
  } catch (e) {
    if (e instanceof Error && /unique|duplicate/i.test(e.message)) {
      return fail("DUPLICATE", "Nama kategori sudah ada");
    }
    return fail("DB_ERROR", e instanceof Error ? e.message : "DB error");
  }
}

export async function deleteExpenseCategory(
  id: string,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "expense.category.delete")) {
    return fail("FORBIDDEN", "Hapus kategori hanya untuk Owner");
  }

  const [before] = await db
    .select()
    .from(expenseCategories)
    .where(and(eq(expenseCategories.id, id), isNull(expenseCategories.deletedAt)))
    .limit(1);
  if (!before) return fail("NOT_FOUND", "Kategori tidak ditemukan");
  if (before.isSystem) {
    return fail(
      "BUSINESS_RULE_VIOLATION",
      "Kategori sistem (Refund) tidak bisa dihapus",
    );
  }

  // Block delete if any active expense references this category
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(expenses)
    .where(
      and(
        eq(expenses.categoryId, id),
        isNull(expenses.deletedAt),
      ),
    );
  if (count > 0) {
    return fail(
      "CATEGORY_HAS_EXPENSES",
      `Masih ada ${count} pengeluaran aktif di kategori ini. Pindah atau hapus dulu.`,
    );
  }

  const [row] = await db
    .update(expenseCategories)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(expenseCategories.id, id))
    .returning({ id: expenseCategories.id });

  await logAudit({
    eventType: "expense_category.delete",
    userId: session.user.id,
    entityType: "expense_category",
    entityId: row.id,
    payload: { summary: `Hapus kategori "${before.name}"` },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok({ id: row.id });
}
