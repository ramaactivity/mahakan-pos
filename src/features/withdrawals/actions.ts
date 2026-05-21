"use server";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccounts,
  capitalMovements,
  investors,
  withdrawalRequests,
} from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
import {
  lockBankAccountAdvisory,
  lockInvestors,
} from "@/lib/db/locking";
import { recordJournal } from "@/features/accounting/posting";
import {
  mapDividendWithdrawal,
  mapDividendWithdrawalReversal,
  resolveBankCodeFromBankName,
} from "@/features/accounting/mapping/dividendWithdrawal";
import { listWithdrawals } from "./queries";
import {
  postWithdrawalSchema,
  reverseWithdrawalSchema,
} from "./schemas";
import {
  fail,
  ok,
  type ApiResult,
  type PostWithdrawalInput,
  type ReverseWithdrawalInput,
  type WithdrawalListRow,
  type WithdrawalRequest,
} from "./types";

/**
 * Sesi AE-80 — Withdrawal actions.
 *
 * postWithdrawal (owner-only, direct):
 *   1. Validate input (Zod) + amount ≥ Rp 50.000.
 *   2. Transaction:
 *      a. lockInvestors([investorId]) — prevent concurrent withdrawal.
 *      b. lockBankAccountAdvisory(bankAccountId) — serialize per-bank.
 *      c. Re-check investor.dividend_balance >= amount (post-lock).
 *      d. recordJournal sourceType='dividend_withdrawal' → Dr 3202 / Cr Bank.
 *      e. Insert withdrawal_requests + capital_movements kind='dividend_withdrawal'.
 *      f. UPDATE investor.dividend_balance -= amount (CHECK >= 0 last defense).
 *      g. Update withdrawal_requests dengan journalEntryId + capitalMovementId.
 *   3. Audit log.
 *
 * reverseWithdrawal (owner-only, idempotent):
 *   1. Validate + cek status='posted'.
 *   2. Transaction: post reversing journal, insert reversal movement,
 *      restore investor.dividend_balance += amount, mark withdrawal reversed.
 *   3. Audit log.
 */

async function requireSession() {
  const s = await auth();
  if (!s) throw new Error("UNAUTHORIZED");
  return s;
}

export async function fetchWithdrawals(opts?: {
  investorId?: string;
  limit?: number;
}): Promise<ApiResult<WithdrawalListRow[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat pencairan");
  }
  const rows = await listWithdrawals({
    outletId: session.user.outletId,
    investorId: opts?.investorId,
    limit: opts?.limit,
  });
  return ok(rows);
}

export async function postWithdrawal(
  input: PostWithdrawalInput,
): Promise<ApiResult<WithdrawalRequest>> {
  const session = await requireSession();
  /* Permission: distribution.approve (owner-only) — withdrawal adalah
   * critical money movement; manager view-only. */
  if (!hasPermission(session.user.role, "distribution.approve")) {
    return fail("FORBIDDEN", "Tidak punya hak pencairan dividen");
  }
  const parsed = postWithdrawalSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      "VALIDATION_ERROR",
      issue?.message ?? "Input tidak valid",
      issue?.path?.[0]?.toString(),
    );
  }
  const v = parsed.data;

  /* Pre-fetch investor + bank untuk validate + resolve. */
  const [inv] = await db
    .select({
      id: investors.id,
      outletId: investors.outletId,
      fullName: investors.fullName,
      dividendBalance: investors.dividendBalance,
      status: investors.status,
    })
    .from(investors)
    .where(eq(investors.id, v.investorId))
    .limit(1);
  if (!inv) return fail("NOT_FOUND", "Investor tidak ditemukan");
  if (inv.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Investor dari outlet lain");
  }
  if (inv.status !== "active") {
    return fail(
      "INVESTOR_INACTIVE",
      `Investor status ${inv.status} — tidak bisa tarik saldo`,
    );
  }
  if (inv.dividendBalance < v.amount) {
    return fail(
      "BALANCE_INSUFFICIENT",
      `Saldo dividen ${inv.fullName} hanya Rp ${inv.dividendBalance.toLocaleString("id-ID")}, perlu Rp ${v.amount.toLocaleString("id-ID")}`,
      "amount",
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
  if (!bank.isActive) {
    return fail("BANK_INACTIVE", "Bank account non-aktif");
  }

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

  const occurredAt = v.occurredAt ? new Date(v.occurredAt) : new Date();
  const entryDate = occurredAt.toISOString().slice(0, 10);

  try {
    const result = await db.transaction(async (tx) => {
      /* Lock investor row + bank advisory. */
      await lockInvestors(tx, [v.investorId]);
      await lockBankAccountAdvisory(tx, v.bankAccountId);

      /* Re-check balance setelah lock (race-safe). */
      const [reInv] = await tx
        .select({ dividendBalance: investors.dividendBalance })
        .from(investors)
        .where(eq(investors.id, v.investorId))
        .limit(1);
      if (!reInv || reInv.dividendBalance < v.amount) {
        throw new Error(
          `BALANCE_INSUFFICIENT:${inv.fullName}:${reInv?.dividendBalance ?? 0}`,
        );
      }

      /* Insert withdrawal_requests row dulu untuk dapat ID (untuk sourceId
       * journal). */
      const [wrRow] = await tx
        .insert(withdrawalRequests)
        .values({
          outletId: session.user.outletId,
          investorId: v.investorId,
          amount: v.amount,
          bankAccountId: v.bankAccountId,
          occurredAt,
          description: v.description ?? null,
          status: "posted",
          createdBy: session.user.id,
        })
        .returning();

      /* Post journal Dr 3202 / Cr Bank. */
      const lines = mapDividendWithdrawal({
        amount: v.amount,
        bankAccountCode,
        bankDestinationLabel,
        investorName: inv.fullName,
      });
      const journalResult = await recordJournal({
        outletId: session.user.outletId,
        entryDate,
        description: `Pencairan dividen ${inv.fullName} — Rp ${v.amount.toLocaleString("id-ID")}`,
        sourceType: "dividend_withdrawal",
        sourceId: wrRow.id,
        lines,
        status: "posted",
        actorId: session.user.id,
        metadata: {
          withdrawalId: wrRow.id,
          investorId: v.investorId,
          investorName: inv.fullName,
          bankAccountId: v.bankAccountId,
        },
      });

      /* Insert capital_movements kind='dividend_withdrawal'. */
      const [movement] = await tx
        .insert(capitalMovements)
        .values({
          outletId: session.user.outletId,
          holderType: "investor",
          holderId: v.investorId,
          kind: "dividend_withdrawal",
          amount: v.amount,
          occurredAt,
          description: `Pencairan ke ${bankDestinationLabel}`,
          journalEntryId: journalResult.entryId,
          createdBy: session.user.id,
        })
        .returning({ id: capitalMovements.id });

      /* Update withdrawal_requests link ke journal + movement. */
      await tx
        .update(withdrawalRequests)
        .set({
          journalEntryId: journalResult.entryId,
          capitalMovementId: movement.id,
        })
        .where(eq(withdrawalRequests.id, wrRow.id));

      /* Decrement investor.dividend_balance. CHECK >= 0 enforce. */
      await tx
        .update(investors)
        .set({
          dividendBalance: sql`${investors.dividendBalance} - ${v.amount}`,
        })
        .where(eq(investors.id, v.investorId));

      return { withdrawalId: wrRow.id, journalEntryId: journalResult.entryId };
    });

    logAudit({
      eventType: "withdrawal.post",
      userId: session.user.id,
      entityType: "withdrawal_request",
      entityId: result.withdrawalId,
      payload: {
        summary: `Pencairan dividen ${inv.fullName} Rp ${v.amount.toLocaleString("id-ID")} via ${bankDestinationLabel}`,
        context: {
          investorId: v.investorId,
          amount: v.amount,
          bankAccountId: v.bankAccountId,
          journalEntryId: result.journalEntryId,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit withdrawal.post]", e));

    /* Fetch row final untuk return. */
    const [final] = await db
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.id, result.withdrawalId))
      .limit(1);
    if (!final) return fail("DB_ERROR", "Failed to reload withdrawal");
    return ok(final);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("BALANCE_INSUFFICIENT:")) {
      const parts = msg.split(":");
      return fail(
        "BALANCE_INSUFFICIENT",
        `Saldo dividen ${parts[1] ?? ""} hanya Rp ${Number(parts[2] ?? 0).toLocaleString("id-ID")} — perlu Rp ${v.amount.toLocaleString("id-ID")}`,
        "amount",
      );
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "withdrawal.post", "Operasi database gagal"),
    );
  }
}

export async function reverseWithdrawal(
  input: ReverseWithdrawalInput,
): Promise<ApiResult<{ id: string; journalEntryId: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.approve")) {
    return fail("FORBIDDEN", "Tidak punya hak reverse pencairan");
  }
  const parsed = reverseWithdrawalSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "",
      parsed.error.issues[0]?.path?.[0]?.toString(),
    );
  }
  const v = parsed.data;

  const [wr] = await db
    .select()
    .from(withdrawalRequests)
    .where(eq(withdrawalRequests.id, v.id))
    .limit(1);
  if (!wr) return fail("NOT_FOUND", "Withdrawal tidak ditemukan");
  if (wr.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Withdrawal dari outlet lain");
  }

  /* Idempotent: kalau sudah reversed, return ok. */
  if (wr.status === "reversed") {
    return ok({ id: wr.id, journalEntryId: wr.journalEntryId ?? "" });
  }
  if (wr.status !== "posted") {
    return fail("INVALID_STATE", `Status ${wr.status} — tidak bisa reverse`);
  }

  const [inv] = await db
    .select({ fullName: investors.fullName })
    .from(investors)
    .where(eq(investors.id, wr.investorId))
    .limit(1);
  const investorName = inv?.fullName ?? "(unknown)";

  const [bank] = await db
    .select({
      bankName: bankAccounts.bankName,
      accountName: bankAccounts.accountName,
      accountNumber: bankAccounts.accountNumber,
    })
    .from(bankAccounts)
    .where(eq(bankAccounts.id, wr.bankAccountId))
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
      await lockInvestors(tx, [wr.investorId]);
      await lockBankAccountAdvisory(tx, wr.bankAccountId);

      const lines = mapDividendWithdrawalReversal({
        amount: wr.amount,
        bankAccountCode,
        bankDestinationLabel,
        investorName,
        reason: v.reason,
      });
      const journalResult = await recordJournal({
        outletId: session.user.outletId,
        entryDate,
        description: `Reversal pencairan ${investorName}: ${v.reason.slice(0, 100)}`,
        sourceType: "dividend_withdrawal_reversal",
        sourceId: wr.id,
        lines,
        status: "posted",
        actorId: session.user.id,
        metadata: {
          withdrawalId: wr.id,
          reversalReason: v.reason,
          originalAmount: wr.amount,
        },
      });

      /* Insert reversal movement (kind='reversal'). */
      await tx.insert(capitalMovements).values({
        outletId: session.user.outletId,
        holderType: "investor",
        holderId: wr.investorId,
        kind: "reversal",
        amount: wr.amount,
        occurredAt: new Date(),
        description: `Reversal pencairan: ${v.reason.slice(0, 100)}`,
        journalEntryId: journalResult.entryId,
        parentMovementId: wr.capitalMovementId,
        createdBy: session.user.id,
      });

      /* Mark original movement as reversed. */
      if (wr.capitalMovementId) {
        await tx
          .update(capitalMovements)
          .set({
            reversedAt: new Date(),
            reversedBy: session.user.id,
          })
          .where(eq(capitalMovements.id, wr.capitalMovementId));
      }

      /* Restore investor.dividend_balance += amount. */
      await tx
        .update(investors)
        .set({
          dividendBalance: sql`${investors.dividendBalance} + ${wr.amount}`,
        })
        .where(eq(investors.id, wr.investorId));

      /* Mark withdrawal reversed. */
      await tx
        .update(withdrawalRequests)
        .set({
          status: "reversed",
          reversedAt: new Date(),
          reversedBy: session.user.id,
          reversalReason: v.reason,
        })
        .where(eq(withdrawalRequests.id, wr.id));

      return { journalEntryId: journalResult.entryId };
    });

    logAudit({
      eventType: "withdrawal.reverse",
      userId: session.user.id,
      entityType: "withdrawal_request",
      entityId: wr.id,
      payload: {
        summary: `Reverse pencairan ${investorName} Rp ${wr.amount.toLocaleString("id-ID")}: ${v.reason}`,
        context: {
          reversalReason: v.reason,
          journalEntryId: result.journalEntryId,
          originalAmount: wr.amount,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit withdrawal.reverse]", e));

    return ok({ id: wr.id, journalEntryId: result.journalEntryId });
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "withdrawal.reverse", "Operasi database gagal"),
    );
  }
}

/* Suppress unused-import warning. */
void and;
