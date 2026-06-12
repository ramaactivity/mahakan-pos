"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccounts,
  expenseCategories,
  expenses,
  internalDebtEntries,
  internalDebtParties,
  internalDebtRepayments,
} from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { errorChainIncludes, logAndSanitize } from "@/lib/server-error";
import {
  lockBankAccountAdvisory,
  lockInternalDebtParty,
} from "@/lib/db/locking";
import { recordJournal } from "@/features/accounting/posting";
import { resolveExpenseAccountCode } from "@/features/accounting/hooks";
import {
  mapInternalDebtEntryReversal,
  mapInternalDebtExpense,
  mapInternalDebtLoan,
  mapInternalDebtRepayment,
  mapInternalDebtRepaymentReversal,
} from "@/features/accounting/mapping/internalDebt";
import { resolveBankCodeFromBankName } from "@/features/accounting/mapping/dividendWithdrawal";
import {
  fetchInternalDebtPartyById,
  listInternalDebtEntries,
  listInternalDebtParties,
  listInternalDebtRepayments,
} from "./queries";
import {
  createInternalDebtPartySchema,
  postInternalDebtEntrySchema,
  postInternalDebtRepaymentSchema,
  reverseInternalDebtSchema,
  updateInternalDebtPartySchema,
} from "./schemas";
import {
  fail,
  ok,
  type ApiResult,
  type CreateInternalDebtPartyInput,
  type InternalDebtEntryListRow,
  type InternalDebtParty,
  type InternalDebtPartyListRow,
  type InternalDebtRepaymentListRow,
  type PostInternalDebtEntryInput,
  type PostInternalDebtRepaymentInput,
  type ReverseInternalDebtInput,
  type UpdateInternalDebtPartyInput,
} from "./types";

/**
 * Sesi AE-180 — Hutang Internal (Talangan Owner/Pengelola) actions.
 *
 * Permission RBAC: pakai 'distribution.approve' (owner-only) untuk semua
 * mutation — konsisten dengan modul kreditur karena sama-sama financial
 * obligation sensitif. Manager view-only via 'distribution.view'.
 *
 * Jurnal di-post SINKRON dalam transaction (pattern creditors, bukan
 * fire-and-forget hook) — tidak tergantung feature flag auto-journal.
 */

async function requireSession() {
  const s = await auth();
  if (!s) throw new Error("UNAUTHORIZED");
  return s;
}

function bankLabelOf(bank: {
  bankName: string;
  accountName: string;
  accountNumber: string | null;
}): string {
  const numTail =
    bank.accountNumber && bank.accountNumber.length > 4
      ? `...${bank.accountNumber.slice(-4)}`
      : bank.accountNumber ?? "";
  return [bank.bankName, bank.accountName, numTail].filter(Boolean).join(" — ");
}

async function fetchActiveBank(outletId: string, bankAccountId: string) {
  const [bank] = await db
    .select({
      id: bankAccounts.id,
      outletId: bankAccounts.outletId,
      bankName: bankAccounts.bankName,
      accountName: bankAccounts.accountName,
      accountNumber: bankAccounts.accountNumber,
      isActive: bankAccounts.isActive,
    })
    .from(bankAccounts)
    .where(eq(bankAccounts.id, bankAccountId))
    .limit(1);
  if (!bank) return { error: fail("NOT_FOUND", "Bank account tidak ditemukan") };
  if (bank.outletId !== outletId) {
    return { error: fail("FORBIDDEN", "Bank account dari outlet lain") };
  }
  if (!bank.isActive) {
    return { error: fail("BANK_INACTIVE", "Bank account non-aktif") };
  }
  return { bank };
}

// ============================================================================
// Reads
// ============================================================================

export async function fetchInternalDebtParties(opts?: {
  status?: "active" | "settled" | "all";
}): Promise<ApiResult<InternalDebtPartyListRow[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat hutang internal");
  }
  return ok(
    await listInternalDebtParties({
      outletId: session.user.outletId,
      status: opts?.status,
    }),
  );
}

export async function fetchInternalDebtEntries(opts?: {
  partyId?: string;
  limit?: number;
}): Promise<ApiResult<InternalDebtEntryListRow[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat hutang internal");
  }
  return ok(
    await listInternalDebtEntries({
      outletId: session.user.outletId,
      ...opts,
    }),
  );
}

export async function fetchInternalDebtRepayments(opts?: {
  partyId?: string;
  limit?: number;
}): Promise<ApiResult<InternalDebtRepaymentListRow[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat cicilan");
  }
  return ok(
    await listInternalDebtRepayments({
      outletId: session.user.outletId,
      ...opts,
    }),
  );
}

// ============================================================================
// Party CRUD
// ============================================================================

export async function createInternalDebtParty(
  input: CreateInternalDebtPartyInput,
): Promise<ApiResult<InternalDebtParty>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.approve")) {
    return fail("FORBIDDEN", "Tidak punya hak kelola hutang internal");
  }
  const parsed = createInternalDebtPartySchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      "VALIDATION_ERROR",
      issue?.message ?? "Input tidak valid",
      issue?.path?.[0]?.toString(),
    );
  }
  const v = parsed.data;

  try {
    const [row] = await db
      .insert(internalDebtParties)
      .values({
        outletId: session.user.outletId,
        name: v.name,
        partyType: v.partyType ?? "owner",
        phone: v.phone ?? null,
        bankName: v.bankName ?? null,
        bankAccountNumber: v.bankAccountNumber ?? null,
        bankAccountHolderName: v.bankAccountHolderName ?? null,
        notes: v.notes ?? null,
        createdBy: session.user.id,
        updatedBy: session.user.id,
      })
      .returning();

    logAudit({
      eventType: "internal_debt_party.create",
      userId: session.user.id,
      entityType: "internal_debt_party",
      entityId: row.id,
      payload: {
        summary: `Pihak hutang internal baru: ${v.name} (${v.partyType ?? "owner"})`,
        after: row,
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit internal_debt_party.create]", e));

    return ok(row);
  } catch (e) {
    /* Drizzle 0.45 bungkus error DB di .cause — pakai errorChainIncludes,
     * BUKAN e.message.includes (constraint name tidak ada di wrapper). */
    if (errorChainIncludes(e, "ux_internal_debt_parties_outlet_name")) {
      return fail(
        "DUPLICATE_NAME",
        `"${v.name}" sudah terdaftar sebagai pihak — cek daftar dengan filter "Semua" (mungkin tersembunyi karena hutangnya Rp 0)`,
        "name",
      );
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "internal_debt_party.create", "Gagal buat pihak"),
    );
  }
}

export async function updateInternalDebtParty(
  input: UpdateInternalDebtPartyInput,
): Promise<ApiResult<InternalDebtParty>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.approve")) {
    return fail("FORBIDDEN", "Tidak punya hak kelola hutang internal");
  }
  const parsed = updateInternalDebtPartySchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      "VALIDATION_ERROR",
      issue?.message ?? "",
      issue?.path?.[0]?.toString(),
    );
  }
  const v = parsed.data;

  const existing = await fetchInternalDebtPartyById(
    session.user.outletId,
    v.id,
  );
  if (!existing) return fail("NOT_FOUND", "Pihak tidak ditemukan");

  try {
    const updates: Partial<typeof internalDebtParties.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: session.user.id,
    };
    if (v.name !== undefined) updates.name = v.name;
    if (v.partyType !== undefined) updates.partyType = v.partyType;
    if (v.phone !== undefined) updates.phone = v.phone;
    if (v.bankName !== undefined) updates.bankName = v.bankName;
    if (v.bankAccountNumber !== undefined)
      updates.bankAccountNumber = v.bankAccountNumber;
    if (v.bankAccountHolderName !== undefined)
      updates.bankAccountHolderName = v.bankAccountHolderName;
    if (v.notes !== undefined) updates.notes = v.notes;

    const [row] = await db
      .update(internalDebtParties)
      .set(updates)
      .where(
        and(
          eq(internalDebtParties.id, v.id),
          eq(internalDebtParties.outletId, session.user.outletId),
        ),
      )
      .returning();

    logAudit({
      eventType: "internal_debt_party.update",
      userId: session.user.id,
      entityType: "internal_debt_party",
      entityId: v.id,
      payload: {
        summary: `Update pihak hutang internal ${row.name}`,
        before: existing,
        after: row,
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit internal_debt_party.update]", e));

    return ok(row);
  } catch (e) {
    if (errorChainIncludes(e, "ux_internal_debt_parties_outlet_name")) {
      return fail(
        "DUPLICATE_NAME",
        "Nama sudah dipakai pihak lain — cek daftar dengan filter \"Semua\"",
        "name",
      );
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "internal_debt_party.update", "Gagal update pihak"),
    );
  }
}

export async function deleteInternalDebtParty(
  id: string,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.approve")) {
    return fail("FORBIDDEN", "Tidak punya hak kelola hutang internal");
  }
  const existing = await fetchInternalDebtPartyById(session.user.outletId, id);
  if (!existing) return fail("NOT_FOUND", "Pihak tidak ditemukan");
  if (existing.totalOutstanding > 0) {
    return fail(
      "INVALID_STATE",
      `${existing.name} masih punya hutang outstanding Rp ${existing.totalOutstanding.toLocaleString("id-ID")}. Lunaskan atau reverse entry dulu.`,
    );
  }
  await db
    .update(internalDebtParties)
    .set({
      deletedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(
      and(
        eq(internalDebtParties.id, id),
        eq(internalDebtParties.outletId, session.user.outletId),
      ),
    );

  logAudit({
    eventType: "internal_debt_party.delete",
    userId: session.user.id,
    entityType: "internal_debt_party",
    entityId: id,
    payload: {
      summary: `Hapus pihak hutang internal ${existing.name}`,
      before: existing,
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit internal_debt_party.delete]", e));

  return ok({ id });
}

// ============================================================================
// Entry flow (hutang masuk: talangan biaya / pinjaman tunai)
// ============================================================================

export async function postInternalDebtEntry(
  input: PostInternalDebtEntryInput,
): Promise<ApiResult<{ id: string; journalEntryId: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.approve")) {
    return fail("FORBIDDEN", "Tidak punya hak catat hutang internal");
  }
  const parsed = postInternalDebtEntrySchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      "VALIDATION_ERROR",
      issue?.message ?? "",
      issue?.path?.[0]?.toString(),
    );
  }
  const v = parsed.data;

  const party = await fetchInternalDebtPartyById(
    session.user.outletId,
    v.partyId,
  );
  if (!party) return fail("NOT_FOUND", "Pihak tidak ditemukan");

  const occurredAt = v.occurredAt ? new Date(v.occurredAt) : new Date();
  const entryDate = occurredAt.toISOString().slice(0, 10);

  /* Pre-resolve per kind: akun beban + kategori (expense_advance) atau
   * bank code (cash_loan) di luar transaction. */
  let expenseAccountCode = "";
  let bankAccountCode = "";
  let bankLabel = "";
  if (v.kind === "expense_advance") {
    const [cat] = await db
      .select({ id: expenseCategories.id })
      .from(expenseCategories)
      .where(
        and(
          eq(expenseCategories.id, v.categoryId!),
          eq(expenseCategories.outletId, session.user.outletId),
          isNull(expenseCategories.deletedAt),
        ),
      )
      .limit(1);
    if (!cat) {
      return fail(
        "VALIDATION_ERROR",
        "Kategori tidak ditemukan atau bukan milik outlet kamu",
        "categoryId",
      );
    }
    expenseAccountCode = await resolveExpenseAccountCode(
      session.user.outletId,
      null,
      v.categoryId!,
    );
  } else {
    const res = await fetchActiveBank(session.user.outletId, v.bankAccountId!);
    if (res.error) return res.error;
    bankAccountCode = resolveBankCodeFromBankName(res.bank.bankName);
    bankLabel = bankLabelOf(res.bank);
  }

  try {
    const result = await db.transaction(async (tx) => {
      await lockInternalDebtParty(tx, v.partyId);

      /* Insert entry dulu untuk dapat sourceId journal. */
      const [entry] = await tx
        .insert(internalDebtEntries)
        .values({
          outletId: session.user.outletId,
          partyId: v.partyId,
          kind: v.kind,
          amount: v.amount,
          occurredAt,
          description: v.description,
          categoryId: v.kind === "expense_advance" ? v.categoryId : null,
          bankAccountId: v.kind === "cash_loan" ? v.bankAccountId : null,
          status: "posted",
          createdBy: session.user.id,
        })
        .returning();

      /* Talangan biaya → auto-create expenses row supaya muncul di
       * Keuangan → Pengeluaran + P&L. Jurnal TIDAK lewat hook
       * expense_create (skip sourceType != 'manual') — di-post di sini
       * dengan Cr 2170 (bukan Cr kas). */
      let expenseId: string | null = null;
      if (v.kind === "expense_advance") {
        const [exp] = await tx
          .insert(expenses)
          .values({
            outletId: session.user.outletId,
            expenseDate: entryDate,
            categoryId: v.categoryId!,
            description: `${v.description} (talangan ${party.name})`,
            amount: v.amount,
            paymentMethod: "other",
            sourceType: "internal_debt",
            createdBy: session.user.id,
          })
          .returning({ id: expenses.id });
        expenseId = exp.id;
      }

      const lines =
        v.kind === "expense_advance"
          ? mapInternalDebtExpense({
              amount: v.amount,
              expenseAccountCode,
              description: v.description,
              partyName: party.name,
            })
          : mapInternalDebtLoan({
              amount: v.amount,
              bankAccountCode,
              bankLabel,
              partyName: party.name,
            });

      const journalResult = await recordJournal({
        outletId: session.user.outletId,
        entryDate,
        description:
          v.kind === "expense_advance"
            ? `Talangan ${party.name}: ${v.description} — Rp ${v.amount.toLocaleString("id-ID")}`
            : `Pinjaman tunai dari ${party.name} — Rp ${v.amount.toLocaleString("id-ID")}`,
        sourceType:
          v.kind === "expense_advance"
            ? "internal_debt_expense"
            : "internal_debt_loan",
        sourceId: entry.id,
        lines,
        status: "posted",
        actorId: session.user.id,
        metadata: {
          entryId: entry.id,
          partyId: v.partyId,
          partyName: party.name,
          kind: v.kind,
          amount: v.amount,
          expenseId,
        },
      });

      /* Update party outstanding + link journal/expense ke entry. */
      await tx
        .update(internalDebtParties)
        .set({
          totalOutstanding: sql`${internalDebtParties.totalOutstanding} + ${v.amount}`,
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(eq(internalDebtParties.id, v.partyId));

      await tx
        .update(internalDebtEntries)
        .set({ journalEntryId: journalResult.entryId, expenseId })
        .where(eq(internalDebtEntries.id, entry.id));

      return { entryId: entry.id, journalEntryId: journalResult.entryId };
    });

    logAudit({
      eventType: "internal_debt_entry.post",
      userId: session.user.id,
      entityType: "internal_debt_entry",
      entityId: result.entryId,
      payload: {
        summary: `${v.kind === "expense_advance" ? "Talangan biaya" : "Pinjaman tunai"} ${party.name}: Rp ${v.amount.toLocaleString("id-ID")} — ${v.description}`,
        context: {
          partyId: v.partyId,
          kind: v.kind,
          amount: v.amount,
          journalEntryId: result.journalEntryId,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit internal_debt_entry.post]", e));

    return ok({ id: result.entryId, journalEntryId: result.journalEntryId });
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "internal_debt_entry.post", "Operasi database gagal"),
    );
  }
}

export async function reverseInternalDebtEntry(
  input: ReverseInternalDebtInput,
): Promise<ApiResult<{ id: string; journalEntryId: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.approve")) {
    return fail("FORBIDDEN", "Tidak punya hak reverse hutang internal");
  }
  const parsed = reverseInternalDebtSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }
  const v = parsed.data;

  const [entry] = await db
    .select()
    .from(internalDebtEntries)
    .where(eq(internalDebtEntries.id, v.id))
    .limit(1);
  if (!entry) return fail("NOT_FOUND", "Entry tidak ditemukan");
  if (entry.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Entry dari outlet lain");
  }
  if (entry.status === "reversed") {
    return ok({ id: entry.id, journalEntryId: entry.journalEntryId ?? "" });
  }

  const party = await fetchInternalDebtPartyById(
    session.user.outletId,
    entry.partyId,
  );
  if (!party) return fail("NOT_FOUND", "Pihak tidak ditemukan");
  if (party.totalOutstanding < entry.amount) {
    return fail(
      "INVALID_STATE",
      `Sisa hutang ${party.name} (Rp ${party.totalOutstanding.toLocaleString("id-ID")}) < nominal entry (Rp ${entry.amount.toLocaleString("id-ID")}) — sebagian sudah dicicil. Reverse cicilannya dulu.`,
    );
  }

  /* Resolve counter account (lawan 2170 di entry original). */
  let counterAccountCode: string;
  if (entry.kind === "expense_advance") {
    counterAccountCode = await resolveExpenseAccountCode(
      session.user.outletId,
      null,
      entry.categoryId!,
    );
  } else {
    const [bank] = await db
      .select({ bankName: bankAccounts.bankName })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, entry.bankAccountId!))
      .limit(1);
    counterAccountCode = bank
      ? resolveBankCodeFromBankName(bank.bankName)
      : "1112";
  }

  const entryDate = new Date().toISOString().slice(0, 10);

  try {
    const result = await db.transaction(async (tx) => {
      await lockInternalDebtParty(tx, entry.partyId);

      /* Re-check outstanding post-lock. */
      const [reP] = await tx
        .select({
          totalOutstanding: internalDebtParties.totalOutstanding,
        })
        .from(internalDebtParties)
        .where(eq(internalDebtParties.id, entry.partyId))
        .limit(1);
      if (!reP || reP.totalOutstanding < entry.amount) {
        throw new Error("OUTSTANDING_INSUFFICIENT");
      }

      const lines = mapInternalDebtEntryReversal({
        amount: entry.amount,
        counterAccountCode,
        partyName: party.name,
        reason: v.reason,
      });

      const journalResult = await recordJournal({
        outletId: session.user.outletId,
        entryDate,
        description: `Reversal hutang internal ${party.name}: ${v.reason.slice(0, 100)}`,
        sourceType: "internal_debt_entry_reversal",
        sourceId: entry.id,
        lines,
        status: "posted",
        actorId: session.user.id,
        metadata: {
          entryId: entry.id,
          reversalReason: v.reason,
          originalAmount: entry.amount,
          kind: entry.kind,
        },
      });

      await tx
        .update(internalDebtParties)
        .set({
          totalOutstanding: sql`${internalDebtParties.totalOutstanding} - ${entry.amount}`,
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(eq(internalDebtParties.id, entry.partyId));

      await tx
        .update(internalDebtEntries)
        .set({
          status: "reversed",
          reversedAt: new Date(),
          reversedBy: session.user.id,
          reversalReason: v.reason,
        })
        .where(eq(internalDebtEntries.id, entry.id));

      /* Soft-delete linked expense row supaya Pengeluaran konsisten. */
      if (entry.expenseId) {
        await tx
          .update(expenses)
          .set({
            deletedAt: new Date(),
            deletedBy: session.user.id,
            updatedAt: new Date(),
            updatedBy: session.user.id,
          })
          .where(
            and(
              eq(expenses.id, entry.expenseId),
              eq(expenses.outletId, session.user.outletId),
            ),
          );
      }

      return { journalEntryId: journalResult.entryId };
    });

    logAudit({
      eventType: "internal_debt_entry.reverse",
      userId: session.user.id,
      entityType: "internal_debt_entry",
      entityId: entry.id,
      payload: {
        summary: `Reverse entry hutang internal ${party.name} Rp ${entry.amount.toLocaleString("id-ID")}: ${v.reason}`,
        context: {
          reversalReason: v.reason,
          journalEntryId: result.journalEntryId,
          kind: entry.kind,
          expenseId: entry.expenseId,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit internal_debt_entry.reverse]", e));

    return ok({ id: entry.id, journalEntryId: result.journalEntryId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "OUTSTANDING_INSUFFICIENT") {
      return fail(
        "INVALID_STATE",
        "Sisa hutang tidak cukup untuk reverse entry ini — reverse cicilannya dulu",
      );
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(
        e,
        "internal_debt_entry.reverse",
        "Operasi database gagal",
      ),
    );
  }
}

// ============================================================================
// Repayment flow (cicilan)
// ============================================================================

export async function postInternalDebtRepayment(
  input: PostInternalDebtRepaymentInput,
): Promise<ApiResult<{ id: string; journalEntryId: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.approve")) {
    return fail("FORBIDDEN", "Tidak punya hak bayar cicilan hutang internal");
  }
  const parsed = postInternalDebtRepaymentSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      "VALIDATION_ERROR",
      issue?.message ?? "",
      issue?.path?.[0]?.toString(),
    );
  }
  const v = parsed.data;

  const party = await fetchInternalDebtPartyById(
    session.user.outletId,
    v.partyId,
  );
  if (!party) return fail("NOT_FOUND", "Pihak tidak ditemukan");
  if (v.amount > party.totalOutstanding) {
    return fail(
      "INVALID_AMOUNT",
      `Cicilan Rp ${v.amount.toLocaleString("id-ID")} > sisa hutang Rp ${party.totalOutstanding.toLocaleString("id-ID")}`,
      "amount",
    );
  }

  const res = await fetchActiveBank(session.user.outletId, v.bankAccountId);
  if (res.error) return res.error;
  const bankAccountCode = resolveBankCodeFromBankName(res.bank.bankName);
  const bankLabel = bankLabelOf(res.bank);

  const occurredAt = v.occurredAt ? new Date(v.occurredAt) : new Date();
  const entryDate = occurredAt.toISOString().slice(0, 10);

  try {
    const result = await db.transaction(async (tx) => {
      await lockInternalDebtParty(tx, v.partyId);
      await lockBankAccountAdvisory(tx, v.bankAccountId);

      /* Re-check outstanding post-lock. */
      const [reP] = await tx
        .select({
          totalOutstanding: internalDebtParties.totalOutstanding,
        })
        .from(internalDebtParties)
        .where(eq(internalDebtParties.id, v.partyId))
        .limit(1);
      if (!reP) throw new Error("PARTY_NOT_FOUND");
      if (v.amount > reP.totalOutstanding) {
        throw new Error(`AMOUNT_OVER:${party.name}:${reP.totalOutstanding}`);
      }

      const [rp] = await tx
        .insert(internalDebtRepayments)
        .values({
          outletId: session.user.outletId,
          partyId: v.partyId,
          bankAccountId: v.bankAccountId,
          occurredAt,
          amount: v.amount,
          description: v.description ?? null,
          status: "posted",
          createdBy: session.user.id,
        })
        .returning();

      const lines = mapInternalDebtRepayment({
        amount: v.amount,
        bankAccountCode,
        bankLabel,
        partyName: party.name,
      });
      const journalResult = await recordJournal({
        outletId: session.user.outletId,
        entryDate,
        description: `Cicilan hutang internal ke ${party.name} — Rp ${v.amount.toLocaleString("id-ID")}`,
        sourceType: "internal_debt_repayment",
        sourceId: rp.id,
        lines,
        status: "posted",
        actorId: session.user.id,
        metadata: {
          repaymentId: rp.id,
          partyId: v.partyId,
          partyName: party.name,
          amount: v.amount,
        },
      });

      const newOutstanding = reP.totalOutstanding - v.amount;
      await tx
        .update(internalDebtParties)
        .set({
          totalOutstanding: newOutstanding,
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(eq(internalDebtParties.id, v.partyId));

      await tx
        .update(internalDebtRepayments)
        .set({ journalEntryId: journalResult.entryId })
        .where(eq(internalDebtRepayments.id, rp.id));

      return {
        repaymentId: rp.id,
        journalEntryId: journalResult.entryId,
        newOutstanding,
      };
    });

    logAudit({
      eventType: "internal_debt_repayment.post",
      userId: session.user.id,
      entityType: "internal_debt_repayment",
      entityId: result.repaymentId,
      payload: {
        summary: `Cicilan hutang internal ${party.name}: Rp ${v.amount.toLocaleString("id-ID")} via ${bankLabel}`,
        context: {
          partyId: v.partyId,
          amount: v.amount,
          newOutstanding: result.newOutstanding,
          journalEntryId: result.journalEntryId,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit internal_debt_repayment.post]", e));

    return ok({
      id: result.repaymentId,
      journalEntryId: result.journalEntryId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("AMOUNT_OVER:")) {
      const parts = msg.split(":");
      return fail(
        "INVALID_AMOUNT",
        `Cicilan > sisa hutang Rp ${Number(parts[2] ?? 0).toLocaleString("id-ID")} (${parts[1] ?? ""})`,
        "amount",
      );
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(
        e,
        "internal_debt_repayment.post",
        "Operasi database gagal",
      ),
    );
  }
}

export async function reverseInternalDebtRepayment(
  input: ReverseInternalDebtInput,
): Promise<ApiResult<{ id: string; journalEntryId: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.approve")) {
    return fail("FORBIDDEN", "Tidak punya hak reverse cicilan");
  }
  const parsed = reverseInternalDebtSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "");
  }
  const v = parsed.data;

  const [rp] = await db
    .select()
    .from(internalDebtRepayments)
    .where(eq(internalDebtRepayments.id, v.id))
    .limit(1);
  if (!rp) return fail("NOT_FOUND", "Cicilan tidak ditemukan");
  if (rp.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Cicilan dari outlet lain");
  }
  if (rp.status === "reversed") {
    return ok({ id: rp.id, journalEntryId: rp.journalEntryId ?? "" });
  }

  const party = await fetchInternalDebtPartyById(
    session.user.outletId,
    rp.partyId,
  );
  if (!party) return fail("NOT_FOUND", "Pihak tidak ditemukan");

  const [bank] = await db
    .select({
      bankName: bankAccounts.bankName,
      accountName: bankAccounts.accountName,
      accountNumber: bankAccounts.accountNumber,
    })
    .from(bankAccounts)
    .where(eq(bankAccounts.id, rp.bankAccountId))
    .limit(1);
  const bankAccountCode = bank
    ? resolveBankCodeFromBankName(bank.bankName)
    : "1112";
  const bankLabel = bank ? bankLabelOf(bank) : "(unknown bank)";

  const entryDate = new Date().toISOString().slice(0, 10);

  try {
    const result = await db.transaction(async (tx) => {
      await lockInternalDebtParty(tx, rp.partyId);
      await lockBankAccountAdvisory(tx, rp.bankAccountId);

      const lines = mapInternalDebtRepaymentReversal({
        amount: rp.amount,
        bankAccountCode,
        bankLabel,
        partyName: party.name,
        reason: v.reason,
      });

      const journalResult = await recordJournal({
        outletId: session.user.outletId,
        entryDate,
        description: `Reversal cicilan hutang internal ${party.name}: ${v.reason.slice(0, 100)}`,
        sourceType: "internal_debt_repayment_reversal",
        sourceId: rp.id,
        lines,
        status: "posted",
        actorId: session.user.id,
        metadata: {
          repaymentId: rp.id,
          reversalReason: v.reason,
          originalAmount: rp.amount,
        },
      });

      /* Restore outstanding. */
      await tx
        .update(internalDebtParties)
        .set({
          totalOutstanding: sql`${internalDebtParties.totalOutstanding} + ${rp.amount}`,
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(eq(internalDebtParties.id, rp.partyId));

      await tx
        .update(internalDebtRepayments)
        .set({
          status: "reversed",
          reversedAt: new Date(),
          reversedBy: session.user.id,
          reversalReason: v.reason,
        })
        .where(eq(internalDebtRepayments.id, rp.id));

      return { journalEntryId: journalResult.entryId };
    });

    logAudit({
      eventType: "internal_debt_repayment.reverse",
      userId: session.user.id,
      entityType: "internal_debt_repayment",
      entityId: rp.id,
      payload: {
        summary: `Reverse cicilan hutang internal ${party.name} Rp ${rp.amount.toLocaleString("id-ID")}: ${v.reason}`,
        context: {
          reversalReason: v.reason,
          journalEntryId: result.journalEntryId,
          restoredAmount: rp.amount,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) =>
      console.error("[audit internal_debt_repayment.reverse]", e),
    );

    return ok({ id: rp.id, journalEntryId: result.journalEntryId });
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(
        e,
        "internal_debt_repayment.reverse",
        "Operasi database gagal",
      ),
    );
  }
}
