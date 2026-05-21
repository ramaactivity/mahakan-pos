"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccounts,
  capitalMovements,
  creditorRepayments,
  creditors,
} from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
import {
  lockBankAccountAdvisory,
  lockCreditor,
} from "@/lib/db/locking";
import { recordJournal } from "@/features/accounting/posting";
import {
  mapCreditorRepayment,
  mapCreditorRepaymentReversal,
} from "@/features/accounting/mapping/creditorRepayment";
import { resolveBankCodeFromBankName } from "@/features/accounting/mapping/dividendWithdrawal";
import {
  listCreditors,
  listCreditorRepayments,
  fetchCreditorById,
} from "./queries";
import {
  createCreditorSchema,
  postRepaymentSchema,
  reverseRepaymentSchema,
  updateCreditorSchema,
} from "./schemas";
import {
  fail,
  ok,
  type ApiResult,
  type CreateCreditorInput,
  type Creditor,
  type CreditorListRow,
  type CreditorRepaymentListRow,
  type PostRepaymentInput,
  type ReverseRepaymentInput,
  type UpdateCreditorInput,
} from "./types";

/**
 * Sesi AE-80 — Creditors + Repayments actions.
 *
 * CRUD creditor: createCreditor, updateCreditor, deleteCreditor (soft).
 * Repayment flow: postRepayment, reverseRepayment.
 *
 * Permission RBAC: pakai 'distribution.approve' (owner-only) untuk semua
 * mutation karena hutang kreditur adalah financial obligation yang
 * sensitif. Manager view-only via 'distribution.view'.
 */

async function requireSession() {
  const s = await auth();
  if (!s) throw new Error("UNAUTHORIZED");
  return s;
}

// ============================================================================
// Creditor CRUD
// ============================================================================

export async function fetchCreditors(opts?: {
  status?: "active" | "settled" | "defaulted" | "all";
}): Promise<ApiResult<CreditorListRow[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat kreditur");
  }
  return ok(
    await listCreditors({
      outletId: session.user.outletId,
      status: opts?.status,
    }),
  );
}

export async function getCreditor(
  id: string,
): Promise<ApiResult<Creditor>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat kreditur");
  }
  const row = await fetchCreditorById(session.user.outletId, id);
  if (!row) return fail("NOT_FOUND", "Kreditur tidak ditemukan");
  return ok(row);
}

export async function fetchRepayments(opts?: {
  creditorId?: string;
  limit?: number;
}): Promise<ApiResult<CreditorRepaymentListRow[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat cicilan");
  }
  return ok(
    await listCreditorRepayments({
      outletId: session.user.outletId,
      ...opts,
    }),
  );
}

export async function createCreditor(
  input: CreateCreditorInput,
): Promise<ApiResult<Creditor>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.approve")) {
    return fail("FORBIDDEN", "Tidak punya hak buat kreditur");
  }
  const parsed = createCreditorSchema.safeParse(input);
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
      .insert(creditors)
      .values({
        outletId: session.user.outletId,
        fullName: v.fullName,
        nickname: v.nickname ?? null,
        nik: v.nik ?? null,
        email: v.email ?? null,
        phone: v.phone ?? null,
        address: v.address ?? null,
        bankName: v.bankName ?? null,
        bankAccountNumber: v.bankAccountNumber ?? null,
        bankAccountHolderName: v.bankAccountHolderName ?? null,
        principalOriginal: v.principalOriginal,
        principalOutstanding: v.principalOriginal, // initial = full
        interestRatePct: String(v.interestRatePct ?? 0),
        interestPeriod: v.interestPeriod ?? "monthly",
        startDate: v.startDate,
        dueDate: v.dueDate ?? null,
        notes: v.notes ?? null,
        status: "active",
        createdBy: session.user.id,
        updatedBy: session.user.id,
      })
      .returning();

    logAudit({
      eventType: "creditor.create",
      userId: session.user.id,
      entityType: "creditor",
      entityId: row.id,
      payload: {
        summary: `Kreditur baru: ${v.fullName} — Pokok Rp ${v.principalOriginal.toLocaleString("id-ID")}`,
        after: row,
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit creditor.create]", e));

    return ok(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("ux_creditors_outlet_nik")) {
      return fail(
        "DUPLICATE_NIK",
        "NIK sudah terdaftar untuk kreditur lain",
        "nik",
      );
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "creditor.create", "Gagal buat kreditur"),
    );
  }
}

export async function updateCreditor(
  input: UpdateCreditorInput,
): Promise<ApiResult<Creditor>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.approve")) {
    return fail("FORBIDDEN", "Tidak punya hak edit kreditur");
  }
  const parsed = updateCreditorSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      "VALIDATION_ERROR",
      issue?.message ?? "",
      issue?.path?.[0]?.toString(),
    );
  }
  const v = parsed.data;

  const existing = await fetchCreditorById(session.user.outletId, v.id);
  if (!existing) return fail("NOT_FOUND", "Kreditur tidak ditemukan");

  /* principalOriginal tidak boleh berkurang dari principalOutstanding
   * (defensive check di app layer; DB CHECK juga enforce
   * principalOutstanding <= principalOriginal). */
  if (
    v.principalOriginal != null &&
    v.principalOriginal < existing.principalOutstanding
  ) {
    return fail(
      "INVALID_PRINCIPAL",
      `Pokok awal tidak boleh < sisa hutang berjalan Rp ${existing.principalOutstanding.toLocaleString("id-ID")}`,
      "principalOriginal",
    );
  }

  try {
    const updates: Partial<typeof creditors.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: session.user.id,
    };
    if (v.fullName !== undefined) updates.fullName = v.fullName;
    if (v.nickname !== undefined) updates.nickname = v.nickname;
    if (v.nik !== undefined) updates.nik = v.nik;
    if (v.email !== undefined) updates.email = v.email;
    if (v.phone !== undefined) updates.phone = v.phone;
    if (v.address !== undefined) updates.address = v.address;
    if (v.bankName !== undefined) updates.bankName = v.bankName;
    if (v.bankAccountNumber !== undefined)
      updates.bankAccountNumber = v.bankAccountNumber;
    if (v.bankAccountHolderName !== undefined)
      updates.bankAccountHolderName = v.bankAccountHolderName;
    if (v.principalOriginal !== undefined)
      updates.principalOriginal = v.principalOriginal;
    if (v.interestRatePct !== undefined)
      updates.interestRatePct = String(v.interestRatePct);
    if (v.interestPeriod !== undefined)
      updates.interestPeriod = v.interestPeriod;
    if (v.startDate !== undefined) updates.startDate = v.startDate;
    if (v.dueDate !== undefined) updates.dueDate = v.dueDate;
    if (v.notes !== undefined) updates.notes = v.notes;
    if (v.status !== undefined) updates.status = v.status;

    const [row] = await db
      .update(creditors)
      .set(updates)
      .where(
        and(
          eq(creditors.id, v.id),
          eq(creditors.outletId, session.user.outletId),
        ),
      )
      .returning();

    logAudit({
      eventType: "creditor.update",
      userId: session.user.id,
      entityType: "creditor",
      entityId: v.id,
      payload: {
        summary: `Update kreditur ${row.fullName}`,
        before: existing,
        after: row,
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit creditor.update]", e));

    return ok(row);
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "creditor.update", "Gagal update kreditur"),
    );
  }
}

export async function deleteCreditor(
  id: string,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.approve")) {
    return fail("FORBIDDEN", "Tidak punya hak hapus kreditur");
  }
  const existing = await fetchCreditorById(session.user.outletId, id);
  if (!existing) return fail("NOT_FOUND", "Kreditur tidak ditemukan");
  if (existing.principalOutstanding > 0 && existing.status === "active") {
    return fail(
      "INVALID_STATE",
      `Kreditur masih punya hutang outstanding Rp ${existing.principalOutstanding.toLocaleString("id-ID")}. Lunaskan dulu atau ubah status ke 'defaulted'.`,
    );
  }
  await db
    .update(creditors)
    .set({
      deletedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(
      and(eq(creditors.id, id), eq(creditors.outletId, session.user.outletId)),
    );

  logAudit({
    eventType: "creditor.delete",
    userId: session.user.id,
    entityType: "creditor",
    entityId: id,
    payload: {
      summary: `Hapus kreditur ${existing.fullName}`,
      before: existing,
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit creditor.delete]", e));

  return ok({ id });
}

// ============================================================================
// Repayment Flow
// ============================================================================

export async function postRepayment(
  input: PostRepaymentInput,
): Promise<ApiResult<{ id: string; journalEntryId: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.approve")) {
    return fail("FORBIDDEN", "Tidak punya hak bayar cicilan kreditur");
  }
  const parsed = postRepaymentSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      "VALIDATION_ERROR",
      issue?.message ?? "",
      issue?.path?.[0]?.toString(),
    );
  }
  const v = parsed.data;

  const creditor = await fetchCreditorById(
    session.user.outletId,
    v.creditorId,
  );
  if (!creditor) return fail("NOT_FOUND", "Kreditur tidak ditemukan");
  if (creditor.status !== "active") {
    return fail(
      "INVALID_STATE",
      `Kreditur status ${creditor.status} — tidak bisa cicil`,
    );
  }
  if (v.principalAmount > creditor.principalOutstanding) {
    return fail(
      "INVALID_PRINCIPAL",
      `Pokok cicilan Rp ${v.principalAmount.toLocaleString("id-ID")} > sisa hutang Rp ${creditor.principalOutstanding.toLocaleString("id-ID")}`,
      "principalAmount",
    );
  }

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
    .where(eq(bankAccounts.id, v.bankAccountId))
    .limit(1);
  if (!bank) return fail("NOT_FOUND", "Bank account tidak ditemukan");
  if (bank.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Bank account dari outlet lain");
  }
  if (!bank.isActive) return fail("BANK_INACTIVE", "Bank account non-aktif");

  const bankAccountCode = resolveBankCodeFromBankName(bank.bankName);
  const bankDestinationLabel = (() => {
    const numTail =
      bank.accountNumber && bank.accountNumber.length > 4
        ? `...${bank.accountNumber.slice(-4)}`
        : bank.accountNumber ?? "";
    return [bank.bankName, bank.accountName, numTail]
      .filter(Boolean)
      .join(" — ");
  })();

  const principal = v.principalAmount;
  const interest = v.interestAmount ?? 0;
  const occurredAt = v.occurredAt ? new Date(v.occurredAt) : new Date();
  const entryDate = occurredAt.toISOString().slice(0, 10);

  try {
    const result = await db.transaction(async (tx) => {
      await lockCreditor(tx, v.creditorId);
      await lockBankAccountAdvisory(tx, v.bankAccountId);

      /* Re-check outstanding post-lock. */
      const [reC] = await tx
        .select({
          principalOutstanding: creditors.principalOutstanding,
          status: creditors.status,
        })
        .from(creditors)
        .where(eq(creditors.id, v.creditorId))
        .limit(1);
      if (!reC || reC.status !== "active") {
        throw new Error("CREDITOR_NOT_ACTIVE");
      }
      if (principal > reC.principalOutstanding) {
        throw new Error(
          `PRINCIPAL_OVER:${creditor.fullName}:${reC.principalOutstanding}`,
        );
      }

      /* Insert repayment row dulu untuk dapat sourceId journal. */
      const [rp] = await tx
        .insert(creditorRepayments)
        .values({
          outletId: session.user.outletId,
          creditorId: v.creditorId,
          bankAccountId: v.bankAccountId,
          occurredAt,
          principalAmount: principal,
          interestAmount: interest,
          description: v.description ?? null,
          status: "posted",
          createdBy: session.user.id,
        })
        .returning();

      /* Post journal Dr 2150 (+ Dr 6701 kalau bunga) / Cr Bank. */
      const lines = mapCreditorRepayment({
        principalAmount: principal,
        interestAmount: interest,
        bankAccountCode,
        bankDestinationLabel,
        creditorName: creditor.fullName,
      });
      const journalResult = await recordJournal({
        outletId: session.user.outletId,
        entryDate,
        description: `Cicilan kreditur ${creditor.fullName} — pokok Rp ${principal.toLocaleString("id-ID")}${interest > 0 ? `, bunga Rp ${interest.toLocaleString("id-ID")}` : ""}`,
        sourceType: "creditor_repayment",
        sourceId: rp.id,
        lines,
        status: "posted",
        actorId: session.user.id,
        metadata: {
          repaymentId: rp.id,
          creditorId: v.creditorId,
          creditorName: creditor.fullName,
          principal,
          interest,
        },
      });

      /* Capital movement trail (kind='creditor_repayment_principal').
       * Holder type: creditor doesn't fit investor/pengelola enum, so
       * skip capital_movements for now (trail via creditor_repayments
       * table cukup). Optional future: extend holderType enum. */

      /* Update creditor outstanding. */
      const newOutstanding = reC.principalOutstanding - principal;
      const newStatus = newOutstanding === 0 ? "settled" : "active";
      await tx
        .update(creditors)
        .set({
          principalOutstanding: newOutstanding,
          status: newStatus,
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(eq(creditors.id, v.creditorId));

      /* Link journalEntryId ke repayment. */
      await tx
        .update(creditorRepayments)
        .set({ journalEntryId: journalResult.entryId })
        .where(eq(creditorRepayments.id, rp.id));

      return {
        repaymentId: rp.id,
        journalEntryId: journalResult.entryId,
        newOutstanding,
        newStatus,
      };
    });

    logAudit({
      eventType: "creditor_repayment.post",
      userId: session.user.id,
      entityType: "creditor_repayment",
      entityId: result.repaymentId,
      payload: {
        summary: `Cicilan ${creditor.fullName}: pokok Rp ${principal.toLocaleString("id-ID")}${interest > 0 ? `, bunga Rp ${interest.toLocaleString("id-ID")}` : ""} via ${bankDestinationLabel}`,
        context: {
          creditorId: v.creditorId,
          principal,
          interest,
          newOutstanding: result.newOutstanding,
          newStatus: result.newStatus,
          journalEntryId: result.journalEntryId,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit creditor_repayment.post]", e));

    return ok({
      id: result.repaymentId,
      journalEntryId: result.journalEntryId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "CREDITOR_NOT_ACTIVE") {
      return fail("INVALID_STATE", "Kreditur sudah non-active");
    }
    if (msg.startsWith("PRINCIPAL_OVER:")) {
      const parts = msg.split(":");
      return fail(
        "INVALID_PRINCIPAL",
        `Pokok cicilan > sisa hutang Rp ${Number(parts[2] ?? 0).toLocaleString("id-ID")} (${parts[1] ?? ""})`,
        "principalAmount",
      );
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "creditor_repayment.post", "Operasi database gagal"),
    );
  }
}

export async function reverseRepayment(
  input: ReverseRepaymentInput,
): Promise<ApiResult<{ id: string; journalEntryId: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.approve")) {
    return fail("FORBIDDEN", "Tidak punya hak reverse cicilan");
  }
  const parsed = reverseRepaymentSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "",
    );
  }
  const v = parsed.data;

  const [rp] = await db
    .select()
    .from(creditorRepayments)
    .where(eq(creditorRepayments.id, v.id))
    .limit(1);
  if (!rp) return fail("NOT_FOUND", "Cicilan tidak ditemukan");
  if (rp.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Cicilan dari outlet lain");
  }
  if (rp.status === "reversed") {
    return ok({ id: rp.id, journalEntryId: rp.journalEntryId ?? "" });
  }
  if (rp.status !== "posted") {
    return fail("INVALID_STATE", `Status ${rp.status} tidak bisa reverse`);
  }

  const creditor = await fetchCreditorById(
    session.user.outletId,
    rp.creditorId,
  );
  if (!creditor) return fail("NOT_FOUND", "Kreditur tidak ditemukan");

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
  const bankDestinationLabel = bank
    ? [
        bank.bankName,
        bank.accountName,
        bank.accountNumber && bank.accountNumber.length > 4
          ? `...${bank.accountNumber.slice(-4)}`
          : bank.accountNumber ?? "",
      ]
        .filter(Boolean)
        .join(" — ")
    : "(unknown bank)";

  const entryDate = new Date().toISOString().slice(0, 10);

  try {
    const result = await db.transaction(async (tx) => {
      await lockCreditor(tx, rp.creditorId);
      await lockBankAccountAdvisory(tx, rp.bankAccountId);

      const lines = mapCreditorRepaymentReversal({
        principalAmount: rp.principalAmount,
        interestAmount: rp.interestAmount,
        bankAccountCode,
        bankDestinationLabel,
        creditorName: creditor.fullName,
        reason: v.reason,
      });

      const journalResult = await recordJournal({
        outletId: session.user.outletId,
        entryDate,
        description: `Reversal cicilan ${creditor.fullName}: ${v.reason.slice(0, 100)}`,
        sourceType: "creditor_repayment_reversal",
        sourceId: rp.id,
        lines,
        status: "posted",
        actorId: session.user.id,
        metadata: {
          repaymentId: rp.id,
          reversalReason: v.reason,
          originalPrincipal: rp.principalAmount,
          originalInterest: rp.interestAmount,
        },
      });

      /* Restore creditor.principalOutstanding += principalAmount. */
      await tx
        .update(creditors)
        .set({
          principalOutstanding: sql`${creditors.principalOutstanding} + ${rp.principalAmount}`,
          status: "active", // restore active kalau sebelumnya settled
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(eq(creditors.id, rp.creditorId));

      /* Mark repayment reversed. */
      await tx
        .update(creditorRepayments)
        .set({
          status: "reversed",
          reversedAt: new Date(),
          reversedBy: session.user.id,
          reversalReason: v.reason,
        })
        .where(eq(creditorRepayments.id, rp.id));

      return { journalEntryId: journalResult.entryId };
    });

    logAudit({
      eventType: "creditor_repayment.reverse",
      userId: session.user.id,
      entityType: "creditor_repayment",
      entityId: rp.id,
      payload: {
        summary: `Reverse cicilan ${creditor.fullName} Rp ${(rp.principalAmount + rp.interestAmount).toLocaleString("id-ID")}: ${v.reason}`,
        context: {
          reversalReason: v.reason,
          journalEntryId: result.journalEntryId,
          restoredPrincipal: rp.principalAmount,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit creditor_repayment.reverse]", e));

    return ok({ id: rp.id, journalEntryId: result.journalEntryId });
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "creditor_repayment.reverse", "Operasi database gagal"),
    );
  }
}

/* Suppress unused-import warnings. */
void capitalMovements;
void isNull;
