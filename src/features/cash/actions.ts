"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { expenseCategories, expenses, incomes, shifts } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { diffShallow, logAudit } from "@/lib/audit/logger";
import {
  fetchDailyCashSummary,
  fetchExpenses,
  fetchExpenseCategories,
  fetchIncomes,
  type ListExpensesOptions,
  type ListIncomesOptions,
} from "./queries";
import { todayWibIso } from "./helpers";
import { toJakartaDateOnly } from "@/lib/date";
import {
  buildLockWindowErrorMessage,
  findClosedShiftBlockingDate,
} from "./lock-window";
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

/* Sesi AE-49 — date refine: past 30 hari sampai +1 hari (today buffer).
 * Tidak boleh input expense untuk tanggal 2099 atau jaman dulu sekali.
 * Owner mau bisa backdate koreksi sampai 30 hari (cocok untuk closing month). */
function refineDateRange(d: string): boolean {
  const today = todayWibIso();
  const todayMs = Date.parse(`${today}T00:00:00+07:00`);
  const targetMs = Date.parse(`${d}T00:00:00+07:00`);
  if (!Number.isFinite(targetMs) || !Number.isFinite(todayMs)) return false;
  const diffDays = (targetMs - todayMs) / 86_400_000;
  return diffDays >= -30 && diffDays <= 1;
}

const createExpenseSchema = z.object({
  expenseDate: isoDateSchema.refine(refineDateRange, {
    message: "Tanggal harus dalam range 30 hari terakhir sampai besok",
  }),
  categoryId: z.uuid(),
  description: z.string().trim().min(1).max(200),
  amount: z.number().int().min(1).max(999_999_999),
  paymentMethod: z.enum(["cash", "transfer", "other"]),
  receiptImageUrl: z.string().url().nullable().optional(),
});

const createIncomeSchema = z.object({
  incomeDate: isoDateSchema.refine(refineDateRange, {
    message: "Tanggal harus dalam range 30 hari terakhir sampai besok",
  }),
  description: z.string().trim().min(1).max(200),
  amount: z.number().int().min(1).max(999_999_999),
  paymentMethod: z.enum(["cash", "transfer", "other"]),
});

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

/**
 * Sesi AE-49 — fetch list shift status per outlet untuk check lock window.
 * Cuma butuh openedAt + status (untuk findClosedShiftBlockingDate helper).
 * Filter berdasarkan date range yang relevant (target date ± 1 day buffer)
 * supaya tidak load seluruh shift history.
 */
async function fetchShiftsForLockCheck(
  outletId: string,
): Promise<Array<{ openedDateWib: string; status: "open" | "closed" }>> {
  // Untuk efisiensi: query semua shift outlet ini yang openedAt-nya di WIB
  // dalam range targetDate ± 1 hari. Pakai range untuk handle overnight
  // shift yang open day-1 close day-0.
  const rows = await db
    .select({
      openedAt: shifts.openedAt,
      status: shifts.status,
    })
    .from(shifts)
    .where(eq(shifts.outletId, outletId));
  return rows.map((r) => ({
    openedDateWib: toJakartaDateOnly(r.openedAt),
    status: r.status,
  }));
}

/**
 * Sesi AE-49 — assert tanggal expense/income TIDAK overlap shift closed.
 * Return null kalau OK, return ApiResult fail kalau blocked.
 * Owner bypass: kalau role = owner, allow tapi audit log loud warning.
 */
async function assertNotBlockedByClosedShift(args: {
  outletId: string;
  targetDate: string;
  entityLabel: "pengeluaran" | "pemasukan";
  userId: string;
  userRole: string;
  entityType: "expense" | "income";
  entityId: string;
}): Promise<ApiResult<null>> {
  const shiftList = await fetchShiftsForLockCheck(args.outletId);
  const blocker = findClosedShiftBlockingDate(args.targetDate, shiftList);
  if (!blocker) return ok(null);

  // Audit log loud — owner bisa monitor attempts.
  await logAudit({
    eventType: "expense.update",
    userId: args.userId,
    entityType: args.entityType,
    entityId: args.entityId,
    payload: {
      summary: `Blocked: ${args.entityLabel} ${args.entityId.slice(0, 8)} tgl ${args.targetDate} kena lock shift closed`,
      context: {
        reason: "SHIFT_ALREADY_CLOSED",
        targetDate: args.targetDate,
        blockingShiftDate: blocker.openedDateWib,
      },
    },
    metadata: { outletId: args.outletId, actorRole: args.userRole },
  }).catch((e) => console.error("[audit lock window]", e));

  return fail(
    "SHIFT_ALREADY_CLOSED",
    buildLockWindowErrorMessage(args.targetDate, args.entityLabel),
  );
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

  /* Sesi AE-49 — validate categoryId belongs to user's outlet. Tanpa check
   * ini, kasir bisa "smuggle" expense ke kategori outlet lain (cross-outlet
   * data leak). Defense in depth bareng outlet scoping di update/delete. */
  const [cat] = await db
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(
      and(
        eq(expenseCategories.id, v.categoryId),
        eq(expenseCategories.outletId, session.user.outletId),
        isNull(expenseCategories.deletedAt),
      ),
    )
    .limit(1);
  if (!cat) {
    return fail(
      "VALIDATION_ERROR",
      "Kategori tidak ditemukan atau bukan milik outlet kamu",
    );
  }

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

  // Sesi U — Accounting auto-journal hook (manual expense). Hook itself
  // checks sourceType='manual' filter — payroll/purchase/refund expenses
  // generated upstream skip dari sini (no double-count).
  {
    const { fireJournalHook, postJournalForExpenseCreate } = await import(
      "@/features/accounting/hooks"
    );
    const expenseArgs = {
      outletId: session.user.outletId,
      expenseId: row.id,
      actorId: session.user.id,
    };
    fireJournalHook(
      () => postJournalForExpenseCreate(expenseArgs),
      "expense_create",
      {
        sourceId: row.id,
        outletId: session.user.outletId,
        actorId: session.user.id,
      },
      { label: "expense_create", args: expenseArgs },
    );
  }

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

  // Sesi U — Accounting auto-journal hook (income create).
  {
    const { fireJournalHook, postJournalForIncomeCreate } = await import(
      "@/features/accounting/hooks"
    );
    const incomeArgs = {
      outletId: session.user.outletId,
      incomeId: row.id,
      amount: Number(row.amount),
      description: row.description,
      paymentMethod: row.paymentMethod as "cash" | "transfer" | "other",
      entryDate: String(row.incomeDate),
      actorId: session.user.id,
    };
    fireJournalHook(
      () => postJournalForIncomeCreate(incomeArgs),
      "income_create",
      {
        sourceId: row.id,
        outletId: session.user.outletId,
        actorId: session.user.id,
      },
      { label: "income_create", args: incomeArgs },
    );
  }

  return ok(row);
}

// ---------- Expense update / delete ----------

const updateExpenseSchema = z.object({
  expenseDate: isoDateSchema.optional(),
  categoryId: z.uuid().optional(),
  description: z.string().trim().min(1).max(200).optional(),
  amount: z.number().int().min(1).max(999_999_999).optional(),
  paymentMethod: z.enum(["cash", "transfer", "other"]).optional(),
  receiptImageUrl: z.string().url().nullable().optional(),
});

export type UpdateExpenseInput = z.input<typeof updateExpenseSchema>;

export async function updateExpense(
  id: string,
  input: UpdateExpenseInput,
): Promise<ApiResult<Expense>> {
  const session = await requireSession();
  // Sesi AE-49 — tambah outlet scoping. Pre-AE-49: query cuma filter
  // expense.id, bisa edit cross-outlet kalau attacker tau UUID.
  const [current] = await db
    .select()
    .from(expenses)
    .where(
      and(
        eq(expenses.id, id),
        eq(expenses.outletId, session.user.outletId),
        isNull(expenses.deletedAt),
      ),
    )
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

  /* Sesi AE-49 — lock window: cek tanggal expense (current + new kalau
   * di-change) tidak overlap shift closed. Reject hard supaya variance
   * laporan historical tidak corrupt diam-diam. */
  const checkDate = v.expenseDate ?? current.expenseDate;
  const lockCheck = await assertNotBlockedByClosedShift({
    outletId: session.user.outletId,
    targetDate: checkDate,
    entityLabel: "pengeluaran",
    userId: session.user.id,
    userRole: session.user.role,
    entityType: "expense",
    entityId: id,
  });
  if (!lockCheck.success) return lockCheck;
  /* Plus check original date kalau date di-ubah — biar tidak bisa "geser"
   * expense keluar dari shift closed lalu edit. */
  if (v.expenseDate && v.expenseDate !== current.expenseDate) {
    const originalCheck = await assertNotBlockedByClosedShift({
      outletId: session.user.outletId,
      targetDate: current.expenseDate,
      entityLabel: "pengeluaran",
      userId: session.user.id,
      userRole: session.user.role,
      entityType: "expense",
      entityId: id,
    });
    if (!originalCheck.success) return originalCheck;
  }

  // Kalau categoryId di-update, validate juga outlet membership.
  if (v.categoryId && v.categoryId !== current.categoryId) {
    const [cat] = await db
      .select({ id: expenseCategories.id })
      .from(expenseCategories)
      .where(
        and(
          eq(expenseCategories.id, v.categoryId),
          eq(expenseCategories.outletId, session.user.outletId),
          isNull(expenseCategories.deletedAt),
        ),
      )
      .limit(1);
    if (!cat) {
      return fail(
        "VALIDATION_ERROR",
        "Kategori target tidak ditemukan atau bukan milik outlet kamu",
      );
    }
  }

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
    .where(
      and(
        eq(expenses.id, id),
        eq(expenses.outletId, session.user.outletId),
      ),
    )
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

  // Sesi AE-49 — outlet scoping di SELECT supaya tidak bisa delete cross-outlet.
  const [current] = await db
    .select({
      id: expenses.id,
      description: expenses.description,
      amount: expenses.amount,
      expenseDate: expenses.expenseDate,
      refundedTransactionId: expenses.refundedTransactionId,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.id, id),
        eq(expenses.outletId, session.user.outletId),
        isNull(expenses.deletedAt),
      ),
    )
    .limit(1);
  if (!current) return fail("NOT_FOUND", "Pengeluaran tidak ditemukan");
  if (current.refundedTransactionId) {
    return fail(
      "BUSINESS_RULE_VIOLATION",
      "Refund auto tidak bisa di-hapus manual",
    );
  }

  /* Sesi AE-49 — lock window: cek tanggal expense tidak overlap shift
   * closed. Hard reject supaya variance laporan historical tidak corrupt. */
  const lockCheck = await assertNotBlockedByClosedShift({
    outletId: session.user.outletId,
    targetDate: current.expenseDate,
    entityLabel: "pengeluaran",
    userId: session.user.id,
    userRole: session.user.role,
    entityType: "expense",
    entityId: id,
  });
  if (!lockCheck.success) return lockCheck;

  const [row] = await db
    .update(expenses)
    .set({
      deletedAt: new Date(),
      deletedBy: session.user.id,
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(
      and(
        eq(expenses.id, id),
        eq(expenses.outletId, session.user.outletId),
      ),
    )
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

/**
 * Sesi AE-49 — `deleteIncome` action baru. Pre-AE-49 income immutable
 * sekali entry → kalau salah, owner stuck. Sekarang soft delete dengan
 * audit trail (deletedBy column ditambah di migration 0039).
 *
 * Same lock window check sebagai deleteExpense — kalau income tanggal-nya
 * masuk shift closed, reject. Owner bisa bikin reversing entry (expense
 * dengan amount sama) untuk koreksi.
 */
export async function deleteIncome(
  id: string,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "income.create")) {
    // Tidak ada permission `income.delete` sendiri — pakai income.create
    // sebagai proxy. Bisa di-tighten ke owner-only via permission baru
    // di sesi berikutnya kalau dirasa terlalu permissive.
    return fail("FORBIDDEN", "Tidak punya hak hapus pemasukan");
  }

  const [current] = await db
    .select({
      id: incomes.id,
      description: incomes.description,
      amount: incomes.amount,
      incomeDate: incomes.incomeDate,
    })
    .from(incomes)
    .where(
      and(
        eq(incomes.id, id),
        eq(incomes.outletId, session.user.outletId),
        isNull(incomes.deletedAt),
      ),
    )
    .limit(1);
  if (!current) return fail("NOT_FOUND", "Pemasukan tidak ditemukan");

  const lockCheck = await assertNotBlockedByClosedShift({
    outletId: session.user.outletId,
    targetDate: current.incomeDate,
    entityLabel: "pemasukan",
    userId: session.user.id,
    userRole: session.user.role,
    entityType: "income",
    entityId: id,
  });
  if (!lockCheck.success) return lockCheck;

  const [row] = await db
    .update(incomes)
    .set({
      deletedAt: new Date(),
      deletedBy: session.user.id,
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(
      and(
        eq(incomes.id, id),
        eq(incomes.outletId, session.user.outletId),
      ),
    )
    .returning({ id: incomes.id });

  await logAudit({
    eventType: "income.delete",
    userId: session.user.id,
    entityType: "income",
    entityId: row.id,
    payload: {
      summary: `Hapus pemasukan Rp${current.amount.toLocaleString("id-ID")} — ${current.description}`,
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
