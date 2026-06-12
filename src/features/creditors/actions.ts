"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccounts,
  capitalMovements,
  creditorRepayments,
  creditors,
  investors,
} from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { errorChainIncludes, logAndSanitize } from "@/lib/server-error";
import {
  lockBankAccountAdvisory,
  lockCreditor,
  lockInvestors,
  lockOutletDividenAdvisory,
} from "@/lib/db/locking";
import { recordJournal } from "@/features/accounting/posting";
import {
  mapCreditorCreate,
  mapCreditorRepayment,
  mapCreditorRepaymentReversal,
} from "@/features/accounting/mapping/creditorRepayment";
import { mapInvestorToCreditorConversion } from "@/features/accounting/mapping/investorToCreditorConversion";
import { resolveBankCodeFromBankName } from "@/features/accounting/mapping/dividendWithdrawal";
import {
  listCreditors,
  listCreditorRepayments,
  fetchCreditorById,
} from "./queries";
import {
  bulkImportCreditorsSchema,
  convertInvestorToCreditorSchema,
  createCreditorSchema,
  postRepaymentSchema,
  reverseRepaymentSchema,
  updateCreditorSchema,
} from "./schemas";
import {
  fail,
  ok,
  type ApiResult,
  type BulkImportCreditorsInput,
  type BulkImportCreditorsResult,
  type ConvertInvestorToCreditorInput,
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

  /* Optional link investor validation: investor harus exist + same outlet.
   * Tidak ada constraint state — link diperbolehkan untuk investor apa saja
   * (active/inactive/exited) karena ini cuma audit pointer. */
  if (v.linkedInvestorId) {
    const [inv] = await db
      .select({ id: investors.id, outletId: investors.outletId })
      .from(investors)
      .where(eq(investors.id, v.linkedInvestorId))
      .limit(1);
    if (!inv) {
      return fail(
        "INVESTOR_NOT_FOUND",
        "Investor link tidak ditemukan",
        "linkedInvestorId",
      );
    }
    if (inv.outletId !== session.user.outletId) {
      return fail(
        "FORBIDDEN",
        "Investor link dari outlet lain",
        "linkedInvestorId",
      );
    }
  }

  /* Audit AE-181 — resolve rekening penerima uang pinjaman (kalau diisi).
   * Diisi → jurnal Dr bank; kosong → hutang lama, Dr 3301 penyesuaian. */
  let receivedBankCode: string | null = null;
  if (v.receivedBankAccountId) {
    const [bank] = await db
      .select({
        outletId: bankAccounts.outletId,
        bankName: bankAccounts.bankName,
        isActive: bankAccounts.isActive,
      })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, v.receivedBankAccountId))
      .limit(1);
    if (!bank) {
      return fail(
        "NOT_FOUND",
        "Rekening penerima tidak ditemukan",
        "receivedBankAccountId",
      );
    }
    if (bank.outletId !== session.user.outletId) {
      return fail(
        "FORBIDDEN",
        "Rekening dari outlet lain",
        "receivedBankAccountId",
      );
    }
    if (!bank.isActive) {
      return fail(
        "BANK_INACTIVE",
        "Rekening penerima non-aktif",
        "receivedBankAccountId",
      );
    }
    receivedBankCode = resolveBankCodeFromBankName(bank.bankName);
  }

  try {
    /* Audit AE-181 — insert + jurnal pengakuan hutang dalam 1 transaction.
     * Sebelumnya createCreditor TIDAK post jurnal sama sekali → GL 2150
     * understate vs subledger (drift 12,9jt terdeteksi audit). */
    const row = await db.transaction(async (tx) => {
      const [created] = await tx
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
          linkedInvestorId: v.linkedInvestorId ?? null,
          createdBy: session.user.id,
          updatedBy: session.user.id,
        })
        .returning();

      await recordJournal({
        outletId: session.user.outletId,
        entryDate: v.startDate.slice(0, 10),
        description: `Pengakuan hutang kreditur ${v.fullName} — Rp ${v.principalOriginal.toLocaleString("id-ID")}${receivedBankCode ? "" : " (hutang lama / penyesuaian saldo)"}`,
        sourceType: "creditor_create",
        sourceId: created.id,
        lines: mapCreditorCreate({
          principal: v.principalOriginal,
          bankAccountCode: receivedBankCode,
          creditorName: v.fullName,
        }),
        status: "posted",
        actorId: session.user.id,
        metadata: {
          creditorId: created.id,
          principal: v.principalOriginal,
          receivedBankAccountId: v.receivedBankAccountId ?? null,
        },
      });

      return created;
    });

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
    /* Sesi AE-180 — drizzle 0.45 bungkus error DB di .cause; pakai
     * errorChainIncludes supaya unique-violation tetap terdeteksi. */
    if (errorChainIncludes(e, "ux_creditors_outlet_nik")) {
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

// ============================================================================
// Convert Investor → Kreditur
// ============================================================================

/**
 * Sesi AE-80 follow-up — Convert investor existing menjadi kreditur.
 *
 * Flow:
 *  1. Validate investor active + outlet match + dividendBalance === 0
 *     (kalau ada saldo dividen belum di-tarik, owner harus settle dulu via
 *     withdrawal — supaya tidak ada equity sisa yang menggantung).
 *  2. Lock investor row + outlet dividen advisory.
 *  3. Tentukan pokok hutang: principalOverride atau modalDisetor investor.
 *  4. Insert creditor (linkedInvestorId + convertedFromInvestorAt populated,
 *     auto-fill nama/kontak/bank dari profil investor).
 *  5. Update investor: status='exited', sharePct='0', exitedAt, exitReason.
 *  6. Insert capital_movements kind='withdrawal' (amount = pokok yg dikonversi).
 *  7. Post journal Dr 3101 Modal Owner / Cr 2150 Hutang Kreditur.
 *  8. Update creditor.principalOriginal = principalOutstanding = pokok.
 *
 * INVARIANT yang di-jaga:
 *  - investor.dividendBalance must be 0 sebelum convert (no dangling equity).
 *  - sharePct investor di-set 0 (sisa share otomatis jadi treasury / company
 *    share di compute v2 berikutnya — pengelola_pool serap).
 *  - principalOverride <= modalDisetor (tidak boleh > supaya tidak generate
 *    equity gain palsu).
 *  - Idempotent loose: kalau investor sudah exited karena convert sebelumnya,
 *    fail dengan ALREADY_EXITED.
 */
export async function convertInvestorToCreditor(
  input: ConvertInvestorToCreditorInput,
): Promise<ApiResult<{ creditorId: string; journalEntryId: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.approve")) {
    return fail("FORBIDDEN", "Tidak punya hak convert investor ke kreditur");
  }
  const parsed = convertInvestorToCreditorSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      "VALIDATION_ERROR",
      issue?.message ?? "Input tidak valid",
      issue?.path?.[0]?.toString(),
    );
  }
  const v = parsed.data;

  /* Pre-check investor di luar tx supaya error message jelas. */
  const [pre] = await db
    .select()
    .from(investors)
    .where(
      and(
        eq(investors.id, v.investorId),
        eq(investors.outletId, session.user.outletId),
        isNull(investors.deletedAt),
      ),
    )
    .limit(1);
  if (!pre) return fail("NOT_FOUND", "Investor tidak ditemukan");
  if (pre.status === "exited") {
    return fail(
      "ALREADY_EXITED",
      "Investor sudah ter-exit (tidak bisa convert ulang)",
    );
  }
  if (pre.status === "inactive") {
    return fail(
      "INVALID_STATE",
      "Investor status inactive — aktifkan dulu sebelum convert",
    );
  }
  if (pre.dividendBalance > 0) {
    return fail(
      "DIVIDEND_BALANCE_NOT_ZERO",
      `Investor masih punya saldo dividen Rp ${pre.dividendBalance.toLocaleString("id-ID")} — tarik dulu via Pencairan sebelum convert`,
    );
  }
  if (pre.modalDisetor <= 0) {
    return fail(
      "INVALID_PRINCIPAL",
      "Investor modalDisetor 0 — tidak ada yang bisa dikonversi",
    );
  }
  const principal = v.principalOverride ?? pre.modalDisetor;
  if (principal > pre.modalDisetor) {
    return fail(
      "INVALID_PRINCIPAL",
      `Pokok hutang Rp ${principal.toLocaleString("id-ID")} > modal investor Rp ${pre.modalDisetor.toLocaleString("id-ID")}`,
      "principalOverride",
    );
  }

  try {
    const result = await db.transaction(async (tx) => {
      /* Lock dulu — investor + outlet advisory untuk serialize concurrent
       * convert / share-transfer / distribution post. */
      await lockInvestors(tx, [v.investorId]);
      await lockOutletDividenAdvisory(tx, session.user.outletId);

      /* Re-fetch investor di dalam lock supaya dapat snapshot post-lock. */
      const [inv] = await tx
        .select()
        .from(investors)
        .where(eq(investors.id, v.investorId))
        .limit(1);
      if (!inv) throw new Error("INVESTOR_NOT_FOUND");
      if (inv.status === "exited") throw new Error("ALREADY_EXITED");
      if (inv.dividendBalance > 0) {
        throw new Error(`DIVIDEND_BALANCE:${inv.dividendBalance}`);
      }
      if (principal > inv.modalDisetor) {
        throw new Error(`PRINCIPAL_OVER:${inv.modalDisetor}`);
      }

      /* Insert creditor dengan auto-fill dari investor + link. */
      const [cred] = await tx
        .insert(creditors)
        .values({
          outletId: session.user.outletId,
          fullName: inv.fullName,
          nickname: inv.nickname,
          nik: inv.nik,
          email: inv.email,
          phone: inv.phone,
          address: inv.address,
          bankName: inv.bankName,
          bankAccountNumber: inv.bankAccountNumber,
          bankAccountHolderName: inv.bankAccountHolderName,
          principalOriginal: principal,
          principalOutstanding: principal,
          interestRatePct: String(v.interestRatePct ?? 0),
          interestPeriod: v.interestPeriod ?? "monthly",
          startDate: v.startDate,
          dueDate: v.dueDate ?? null,
          notes: v.notes ?? null,
          status: "active",
          linkedInvestorId: inv.id,
          convertedFromInvestorAt: new Date(),
          createdBy: session.user.id,
          updatedBy: session.user.id,
        })
        .returning();

      /* Exit investor: status='exited', sharePct=0, exitedAt, exitReason. */
      const previousSharePct = inv.sharePct;
      await tx
        .update(investors)
        .set({
          status: "exited",
          sharePct: "0.0000",
          exitedAt: new Date(),
          exitReason: v.exitReason,
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(eq(investors.id, inv.id));

      /* Capital movement trail untuk investor (kind=withdrawal, amount =
       * pokok yang dikonversi). Journal entry id di-link nanti. */
      const [cm] = await tx
        .insert(capitalMovements)
        .values({
          outletId: session.user.outletId,
          holderType: "investor",
          holderId: inv.id,
          kind: "withdrawal",
          amount: principal,
          occurredAt: new Date(),
          description: `Convert ke kreditur "${cred.fullName}" (sharePct ${previousSharePct}% → 0; reason: ${v.exitReason.slice(0, 100)})`,
          createdBy: session.user.id,
        })
        .returning();

      /* Post journal Dr 3101 / Cr 2150. */
      const lines = mapInvestorToCreditorConversion({
        principalIdr: principal,
        investorName: inv.fullName,
        creditorName: cred.fullName,
      });
      const entryDate = new Date().toISOString().slice(0, 10);
      const journalResult = await recordJournal({
        outletId: session.user.outletId,
        entryDate,
        description: `Convert investor "${inv.fullName}" → kreditur — pokok Rp ${principal.toLocaleString("id-ID")}`,
        sourceType: "investor_to_creditor_conversion",
        sourceId: cred.id,
        lines,
        status: "posted",
        actorId: session.user.id,
        metadata: {
          investorId: inv.id,
          creditorId: cred.id,
          investorName: inv.fullName,
          previousSharePct,
          principal,
          exitReason: v.exitReason,
        },
      });

      /* Link journal ke capital_movement. */
      await tx
        .update(capitalMovements)
        .set({ journalEntryId: journalResult.entryId })
        .where(eq(capitalMovements.id, cm.id));

      return {
        creditorId: cred.id,
        creditorName: cred.fullName,
        journalEntryId: journalResult.entryId,
        previousSharePct,
        principal,
        modalDisetor: inv.modalDisetor,
      };
    });

    logAudit({
      eventType: "creditor.convert_from_investor",
      userId: session.user.id,
      entityType: "creditor",
      entityId: result.creditorId,
      payload: {
        summary: `Convert investor "${pre.fullName}" → kreditur "${result.creditorName}" — pokok Rp ${result.principal.toLocaleString("id-ID")}, sharePct ${result.previousSharePct}% → 0`,
        context: {
          investorId: pre.id,
          creditorId: result.creditorId,
          principal: result.principal,
          principalOverride: v.principalOverride ?? null,
          modalDisetor: result.modalDisetor,
          previousSharePct: result.previousSharePct,
          interestRatePct: v.interestRatePct,
          interestPeriod: v.interestPeriod,
          exitReason: v.exitReason,
          journalEntryId: result.journalEntryId,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) =>
      console.error("[audit creditor.convert_from_investor]", e),
    );

    /* Mirror audit dari sisi investor agar muncul di timeline investor juga. */
    logAudit({
      eventType: "investor.convert_to_creditor",
      userId: session.user.id,
      entityType: "investor",
      entityId: pre.id,
      payload: {
        summary: `Investor "${pre.fullName}" exit & dikonversi jadi kreditur — pokok Rp ${result.principal.toLocaleString("id-ID")}`,
        context: {
          creditorId: result.creditorId,
          principal: result.principal,
          previousSharePct: result.previousSharePct,
          exitReason: v.exitReason,
          journalEntryId: result.journalEntryId,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) =>
      console.error("[audit investor.convert_to_creditor]", e),
    );

    return ok({
      creditorId: result.creditorId,
      journalEntryId: result.journalEntryId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "ALREADY_EXITED") {
      return fail("ALREADY_EXITED", "Investor sudah ter-exit");
    }
    if (msg === "INVESTOR_NOT_FOUND") {
      return fail("NOT_FOUND", "Investor tidak ditemukan");
    }
    if (msg.startsWith("DIVIDEND_BALANCE:")) {
      const bal = msg.split(":")[1] ?? "0";
      return fail(
        "DIVIDEND_BALANCE_NOT_ZERO",
        `Saldo dividen Rp ${Number(bal).toLocaleString("id-ID")} harus 0 — tarik dulu sebelum convert`,
      );
    }
    if (msg.startsWith("PRINCIPAL_OVER:")) {
      const modal = msg.split(":")[1] ?? "0";
      return fail(
        "INVALID_PRINCIPAL",
        `Pokok hutang > modal Rp ${Number(modal).toLocaleString("id-ID")}`,
        "principalOverride",
      );
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(
        e,
        "creditor.convert_from_investor",
        "Gagal convert investor ke kreditur",
      ),
    );
  }
}

// ============================================================================
// Bulk Import (Sesi AE-80 follow-up)
// ============================================================================

/**
 * CSV bulk import untuk creditors. Mirror pattern bulkImportInvestors.
 *
 * Dedup key: (outletId, fullName + start_date) — kalau owner upload 2 row
 * dengan nama sama tapi tanggal mulai beda, treated as different loans.
 * Kalau nama + start_date sama → match existing.
 *
 * mode 'insert_only': skip duplikat. mode 'upsert': update fields kalau match.
 *
 * Status='settled' tetap di-honor (untuk seed historical kreditur yang sudah
 * lunas pre-system).
 */
export async function bulkImportCreditors(
  input: BulkImportCreditorsInput,
): Promise<ApiResult<BulkImportCreditorsResult>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.approve")) {
    return fail("FORBIDDEN", "Tidak punya hak import kreditur");
  }
  const parsed = bulkImportCreditorsSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const { rows, mode } = parsed.data;

  const existing = await db
    .select({
      id: creditors.id,
      fullName: creditors.fullName,
      startDate: creditors.startDate,
    })
    .from(creditors)
    .where(
      and(
        eq(creditors.outletId, session.user.outletId),
        isNull(creditors.deletedAt),
      ),
    );
  const existingByKey = new Map<string, string>();
  for (const r of existing) {
    existingByKey.set(
      `${r.fullName.trim().toLowerCase()}|${r.startDate}`,
      r.id,
    );
  }

  const result: BulkImportCreditorsResult = {
    totalRows: rows.length,
    inserted: 0,
    updated: 0,
    skippedDuplicate: 0,
    errors: [],
  };

  const dedupedRows: Array<{
    rowIdx: number;
    values: typeof creditors.$inferInsert;
  }> = [];
  const upsertTargets: Array<{
    rowIdx: number;
    existingId: string;
    values: Partial<typeof creditors.$inferInsert>;
  }> = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const dedupKey = `${r.fullName.trim().toLowerCase()}|${r.startDate}`;
    const matchedId = existingByKey.get(dedupKey);
    const outstanding = r.principalOutstanding ?? r.principalOriginal;

    if (matchedId) {
      if (mode === "upsert") {
        /* Sesi AE-178 — PARTIAL UPSERT: skip field null/optional supaya
         * re-upload tidak nimpa data existing dengan null. Field wajib
         * (fullName, principal, period, startDate) selalu di-update. */
        const vals: Partial<typeof creditors.$inferInsert> = {
          fullName: r.fullName,
          principalOriginal: r.principalOriginal,
          principalOutstanding: outstanding,
          interestRatePct: String(r.interestRatePct ?? 0),
          interestPeriod: r.interestPeriod ?? "monthly",
          startDate: r.startDate,
          updatedBy: session.user.id,
          updatedAt: new Date(),
        };
        if (r.nickname != null) vals.nickname = r.nickname;
        if (r.nik != null) vals.nik = r.nik;
        if (r.email != null) vals.email = r.email;
        if (r.phone != null) vals.phone = r.phone;
        if (r.address != null) vals.address = r.address;
        if (r.bankName != null) vals.bankName = r.bankName;
        if (r.bankAccountNumber != null)
          vals.bankAccountNumber = r.bankAccountNumber;
        if (r.bankAccountHolderName != null)
          vals.bankAccountHolderName = r.bankAccountHolderName;
        if (r.dueDate != null) vals.dueDate = r.dueDate;
        if (r.notes != null) vals.notes = r.notes;
        if (r.status) vals.status = r.status;
        upsertTargets.push({
          rowIdx: i + 1,
          existingId: matchedId,
          values: vals,
        });
      } else {
        result.skippedDuplicate += 1;
      }
      continue;
    }
    existingByKey.set(dedupKey, "PENDING");
    dedupedRows.push({
      rowIdx: i + 1,
      values: {
        outletId: session.user.outletId,
        fullName: r.fullName,
        nickname: r.nickname ?? null,
        nik: r.nik ?? null,
        email: r.email ?? null,
        phone: r.phone ?? null,
        address: r.address ?? null,
        bankName: r.bankName ?? null,
        bankAccountNumber: r.bankAccountNumber ?? null,
        bankAccountHolderName: r.bankAccountHolderName ?? null,
        principalOriginal: r.principalOriginal,
        principalOutstanding: outstanding,
        interestRatePct: String(r.interestRatePct ?? 0),
        interestPeriod: r.interestPeriod ?? "monthly",
        startDate: r.startDate,
        dueDate: r.dueDate ?? null,
        notes: r.notes ?? null,
        status: r.status ?? (outstanding === 0 ? "settled" : "active"),
        createdBy: session.user.id,
        updatedBy: session.user.id,
      },
    });
  }

  for (const u of upsertTargets) {
    try {
      await db
        .update(creditors)
        .set(u.values)
        .where(
          and(
            eq(creditors.id, u.existingId),
            eq(creditors.outletId, session.user.outletId),
          ),
        );
      result.updated += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "DB error";
      result.errors.push({ row: u.rowIdx, reason: `Update gagal: ${msg}` });
    }
  }

  /* Audit AE-181 — kreditur hasil import = hutang lama → post jurnal
   * pengakuan Dr 3301 (penyesuaian saldo) / Cr 2150 sebesar OUTSTANDING
   * (bukan original — porsi yang sudah dicicil pre-sistem jangan diakui).
   * Jurnal gagal → kreditur tetap ke-insert tapi dilaporkan di errors
   * supaya owner post manual (idempotent via sourceId=creditor.id). */
  const insertedForJournal: Array<{
    id: string;
    rowIdx: number;
    name: string;
    amount: number;
    startDate: string;
  }> = [];

  if (dedupedRows.length > 0) {
    try {
      const insertedRows = await db
        .insert(creditors)
        .values(dedupedRows.map((d) => d.values))
        .onConflictDoNothing()
        .returning({
          id: creditors.id,
          fullName: creditors.fullName,
          principalOutstanding: creditors.principalOutstanding,
          startDate: creditors.startDate,
        });
      result.inserted = insertedRows.length;
      const raced = dedupedRows.length - insertedRows.length;
      if (raced > 0) result.skippedDuplicate += raced;
      for (const r of insertedRows) {
        insertedForJournal.push({
          id: r.id,
          rowIdx: -1,
          name: r.fullName,
          amount: Number(r.principalOutstanding),
          startDate: String(r.startDate),
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Batch insert error";
      console.error("[creditor bulk import batch failed]", msg);
      for (const d of dedupedRows) {
        try {
          const [r] = await db
            .insert(creditors)
            .values(d.values)
            .returning({
              id: creditors.id,
              fullName: creditors.fullName,
              principalOutstanding: creditors.principalOutstanding,
              startDate: creditors.startDate,
            });
          result.inserted += 1;
          insertedForJournal.push({
            id: r.id,
            rowIdx: d.rowIdx,
            name: r.fullName,
            amount: Number(r.principalOutstanding),
            startDate: String(r.startDate),
          });
        } catch (rowErr) {
          const rmsg = rowErr instanceof Error ? rowErr.message : "DB error";
          if (/ux_creditors_outlet_nik/.test(rmsg)) {
            result.skippedDuplicate += 1;
          } else {
            result.errors.push({
              row: d.rowIdx,
              reason: logAndSanitize(rowErr, "creditor.import", "DB error"),
            });
          }
        }
      }
    }
  }

  for (const ins of insertedForJournal) {
    if (ins.amount <= 0) continue; // import lunas — tidak ada hutang diakui
    try {
      await recordJournal({
        outletId: session.user.outletId,
        entryDate: ins.startDate.slice(0, 10),
        description: `Pengakuan hutang kreditur ${ins.name} (import) — Rp ${ins.amount.toLocaleString("id-ID")}`,
        sourceType: "creditor_create",
        sourceId: ins.id,
        lines: mapCreditorCreate({
          principal: ins.amount,
          bankAccountCode: null, // import = hutang lama
          creditorName: ins.name,
        }),
        status: "posted",
        actorId: session.user.id,
        metadata: { creditorId: ins.id, principal: ins.amount, via: "import" },
      });
    } catch (jErr) {
      result.errors.push({
        row: ins.rowIdx,
        reason: `Kreditur "${ins.name}" ter-import tapi jurnal pengakuan gagal — post manual via Akuntansi (Dr 3301 / Cr 2150 Rp ${ins.amount.toLocaleString("id-ID")})`,
      });
      console.error("[creditor.import journal]", jErr);
    }
  }

  logAudit({
    eventType: "creditor.import",
    userId: session.user.id,
    entityType: "creditor",
    entityId: null,
    payload: {
      summary: `Import kreditur: ${result.inserted} baru, ${result.updated} di-update, ${result.skippedDuplicate} duplikat, ${result.errors.length} error`,
      context: {
        totalRows: result.totalRows,
        inserted: result.inserted,
        updated: result.updated,
        skippedDuplicate: result.skippedDuplicate,
        errorCount: result.errors.length,
      },
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  }).catch((e) => console.error("[audit creditor.import]", e));

  return ok(result);
}

/* Suppress unused-import warnings. */
void capitalMovements;
void isNull;
