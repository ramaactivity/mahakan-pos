"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccounts,
  capitalMovements,
  investors,
  shareTransactions,
} from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { logAndSanitize } from "@/lib/server-error";
import { jakartaDateOf, todayJakarta } from "@/lib/tz";
import {
  lockBankAccountAdvisory,
  lockInvestors,
  lockOutletDividenAdvisory,
} from "@/lib/db/locking";
import { recordJournal } from "@/features/accounting/posting";
import { resolveBankCodeFromBankName } from "@/features/accounting/mapping/dividendWithdrawal";
import {
  mapShareBuyback,
  mapShareBuybackReversal,
} from "@/features/accounting/mapping/shareBuyback";
import { listShareTransactions } from "./queries";
import {
  companyBuybackSchema,
  reverseShareTransactionSchema,
  transferShareP2PSchema,
} from "./schemas";
import {
  fail,
  ok,
  type ApiResult,
  type CompanyBuybackInput,
  type ReverseShareTransactionInput,
  type ShareTransaction,
  type ShareTransactionKind,
  type ShareTransactionListRow,
  type TransferShareP2PInput,
} from "./types";

async function requireSession() {
  const s = await auth();
  if (!s) throw new Error("UNAUTHORIZED");
  return s;
}

export async function fetchShareTransactions(opts?: {
  investorId?: string;
  kind?: ShareTransactionKind | "all";
  limit?: number;
}): Promise<ApiResult<ShareTransactionListRow[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat mutasi saham");
  }
  return ok(
    await listShareTransactions({
      outletId: session.user.outletId,
      investorId: opts?.investorId,
      kind: opts?.kind,
      limit: opts?.limit,
    }),
  );
}

/**
 * P2P transfer share antar investor. NO journal posted (transaksi
 * internal antar pribadi, di luar buku perusahaan).
 *
 * Invariant: SUM(share_pct active) HARUS tetap 100% setelah operasi
 * (assert post-op; rollback kalau drift).
 */
export async function transferShareP2P(
  input: TransferShareP2PInput,
): Promise<ApiResult<ShareTransaction>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.approve")) {
    return fail("FORBIDDEN", "Tidak punya hak P2P transfer share");
  }
  const parsed = transferShareP2PSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "",
      parsed.error.issues[0]?.path?.[0]?.toString(),
    );
  }
  const v = parsed.data;

  const fromIdx = await db
    .select({
      id: investors.id,
      outletId: investors.outletId,
      fullName: investors.fullName,
      sharePct: investors.sharePct,
      status: investors.status,
    })
    .from(investors)
    .where(eq(investors.id, v.fromInvestorId))
    .limit(1);
  const toIdx = await db
    .select({
      id: investors.id,
      outletId: investors.outletId,
      fullName: investors.fullName,
      sharePct: investors.sharePct,
      status: investors.status,
    })
    .from(investors)
    .where(eq(investors.id, v.toInvestorId))
    .limit(1);
  const fromInv = fromIdx[0];
  const toInv = toIdx[0];
  if (!fromInv || !toInv) {
    return fail("NOT_FOUND", "Investor source atau target tidak ditemukan");
  }
  if (
    fromInv.outletId !== session.user.outletId ||
    toInv.outletId !== session.user.outletId
  ) {
    return fail("FORBIDDEN", "Investor dari outlet lain");
  }
  if (fromInv.status !== "active" || toInv.status !== "active") {
    return fail(
      "INVALID_STATE",
      `Investor harus aktif. From=${fromInv.status}, To=${toInv.status}`,
    );
  }
  const fromShare = Number(fromInv.sharePct);
  if (fromShare < v.sharePctDelta) {
    return fail(
      "INVALID_DELTA",
      `Investor ${fromInv.fullName} hanya punya ${fromShare}% share, tidak bisa transfer ${v.sharePctDelta}%`,
      "sharePctDelta",
    );
  }

  const occurredAt = v.occurredAt ? new Date(v.occurredAt) : new Date();
  const deltaStr = v.sharePctDelta.toFixed(4);

  try {
    const result = await db.transaction(async (tx) => {
      /* Lock dividen advisory + investor rows. */
      await lockOutletDividenAdvisory(tx, session.user.outletId);
      await lockInvestors(tx, [v.fromInvestorId, v.toInvestorId]);

      /* Re-fetch sharePct post-lock untuk safety. */
      const [reFrom] = await tx
        .select({ sharePct: investors.sharePct })
        .from(investors)
        .where(eq(investors.id, v.fromInvestorId))
        .limit(1);
      if (!reFrom || Number(reFrom.sharePct) < v.sharePctDelta) {
        throw new Error(
          `INVALID_DELTA:${fromInv.fullName}:${reFrom?.sharePct ?? "0"}`,
        );
      }

      /* Update sharePct: from -=, to +=. */
      await tx
        .update(investors)
        .set({
          sharePct: sql`${investors.sharePct} - ${deltaStr}::numeric`,
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(eq(investors.id, v.fromInvestorId));
      await tx
        .update(investors)
        .set({
          sharePct: sql`${investors.sharePct} + ${deltaStr}::numeric`,
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(eq(investors.id, v.toInvestorId));

      /* Insert share_transactions row. No journal. */
      const [stRow] = await tx
        .insert(shareTransactions)
        .values({
          outletId: session.user.outletId,
          kind: "p2p_transfer",
          fromInvestorId: v.fromInvestorId,
          toInvestorId: v.toInvestorId,
          sharePctDelta: deltaStr,
          amountIdr: 0,
          bankAccountId: null,
          occurredAt,
          description: v.description ?? null,
          status: "posted",
          journalEntryId: null,
          createdBy: session.user.id,
        })
        .returning();

      /* Insert capital_movement trail (kind='share_transfer_in/out'). */
      await tx.insert(capitalMovements).values([
        {
          outletId: session.user.outletId,
          holderType: "investor",
          holderId: v.fromInvestorId,
          kind: "share_transfer_out",
          amount: 0,
          occurredAt,
          description: `P2P transfer ${deltaStr}% ke ${toInv.fullName}`,
          createdBy: session.user.id,
        },
        {
          outletId: session.user.outletId,
          holderType: "investor",
          holderId: v.toInvestorId,
          kind: "share_transfer_in",
          amount: 0,
          occurredAt,
          description: `P2P transfer ${deltaStr}% dari ${fromInv.fullName}`,
          createdBy: session.user.id,
        },
      ]);

      /* Post-op invariant: SUM(share_pct active) <= 100. */
      const [sumRow] = await tx
        .select({
          sum: sql<string>`COALESCE(SUM(${investors.sharePct}::numeric), 0)::text`,
        })
        .from(investors)
        .where(
          and(
            eq(investors.outletId, session.user.outletId),
            eq(investors.status, "active"),
            isNull(investors.deletedAt),
          ),
        );
      const sumPost = Number(sumRow?.sum ?? "0");
      if (sumPost > 100.0001) {
        throw new Error(`INVARIANT_SHARE_SUM_OVER:${sumPost}`);
      }

      return stRow;
    });

    logAudit({
      eventType: "share_transaction.p2p_transfer",
      userId: session.user.id,
      entityType: "share_transaction",
      entityId: result.id,
      payload: {
        summary: `P2P transfer ${deltaStr}% dari ${fromInv.fullName} ke ${toInv.fullName}`,
        context: {
          fromInvestorId: v.fromInvestorId,
          toInvestorId: v.toInvestorId,
          sharePctDelta: deltaStr,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit share_transaction.p2p]", e));

    return ok(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("INVALID_DELTA:")) {
      const parts = msg.split(":");
      return fail(
        "INVALID_DELTA",
        `Investor ${parts[1]} hanya punya ${parts[2]}% share`,
        "sharePctDelta",
      );
    }
    if (msg.startsWith("INVARIANT_SHARE_SUM_OVER:")) {
      return fail(
        "INVARIANT_VIOLATION",
        `Total share investor > 100% setelah transfer (${msg.split(":")[1]}). Rolling back.`,
      );
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "share_transaction.p2p", "Operasi database gagal"),
    );
  }
}

/**
 * Company buyback share dari investor. Post journal Dr 3401 / Cr Bank.
 * Investor share_pct turun; sisa% jadi "company hold" (treasury).
 */
export async function companyBuyback(
  input: CompanyBuybackInput,
): Promise<ApiResult<ShareTransaction>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.approve")) {
    return fail("FORBIDDEN", "Tidak punya hak company buyback");
  }
  const parsed = companyBuybackSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "",
      parsed.error.issues[0]?.path?.[0]?.toString(),
    );
  }
  const v = parsed.data;

  const [fromInv] = await db
    .select({
      id: investors.id,
      outletId: investors.outletId,
      fullName: investors.fullName,
      sharePct: investors.sharePct,
      status: investors.status,
    })
    .from(investors)
    .where(eq(investors.id, v.fromInvestorId))
    .limit(1);
  if (!fromInv) return fail("NOT_FOUND", "Investor tidak ditemukan");
  if (fromInv.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Investor dari outlet lain");
  }
  if (fromInv.status !== "active") {
    return fail("INVALID_STATE", "Investor non-aktif tidak bisa buyback");
  }
  if (Number(fromInv.sharePct) < v.sharePctDelta) {
    return fail(
      "INVALID_DELTA",
      `Investor hanya punya ${fromInv.sharePct}% share, tidak bisa buyback ${v.sharePctDelta}%`,
      "sharePctDelta",
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
  if (bank.outletId !== session.user.outletId || !bank.isActive) {
    return fail("FORBIDDEN", "Bank account invalid");
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
  const entryDate = jakartaDateOf(occurredAt);
  const deltaStr = v.sharePctDelta.toFixed(4);

  try {
    const result = await db.transaction(async (tx) => {
      await lockOutletDividenAdvisory(tx, session.user.outletId);
      await lockInvestors(tx, [v.fromInvestorId]);
      await lockBankAccountAdvisory(tx, v.bankAccountId);

      /* Re-check share. */
      const [reFrom] = await tx
        .select({ sharePct: investors.sharePct })
        .from(investors)
        .where(eq(investors.id, v.fromInvestorId))
        .limit(1);
      if (!reFrom || Number(reFrom.sharePct) < v.sharePctDelta) {
        throw new Error(
          `INVALID_DELTA:${fromInv.fullName}:${reFrom?.sharePct ?? "0"}`,
        );
      }

      /* Insert share_transactions row dulu untuk dapat sourceId. */
      const [stRow] = await tx
        .insert(shareTransactions)
        .values({
          outletId: session.user.outletId,
          kind: "company_buyback",
          fromInvestorId: v.fromInvestorId,
          toInvestorId: null,
          sharePctDelta: deltaStr,
          amountIdr: v.amountIdr,
          bankAccountId: v.bankAccountId,
          occurredAt,
          description: v.description ?? null,
          status: "posted",
          createdBy: session.user.id,
        })
        .returning();

      /* Post journal Dr 3401 / Cr Bank. */
      const lines = mapShareBuyback({
        amount: v.amountIdr,
        bankAccountCode,
        bankDestinationLabel,
        investorName: fromInv.fullName,
        sharePctDelta: v.sharePctDelta,
      });
      const journalResult = await recordJournal({
        outletId: session.user.outletId,
        entryDate,
        description: `Buyback ${deltaStr}% saham ${fromInv.fullName} Rp ${v.amountIdr.toLocaleString("id-ID")}`,
        sourceType: "share_buyback",
        sourceId: stRow.id,
        lines,
        status: "posted",
        actorId: session.user.id,
        metadata: {
          shareTransactionId: stRow.id,
          fromInvestorId: v.fromInvestorId,
          sharePctDelta: deltaStr,
          amountIdr: v.amountIdr,
        },
      });

      /* Insert capital_movement (kind='company_buyback') for trail. */
      await tx.insert(capitalMovements).values({
        outletId: session.user.outletId,
        holderType: "investor",
        holderId: v.fromInvestorId,
        kind: "company_buyback",
        amount: v.amountIdr,
        occurredAt,
        description: `Buyback ${deltaStr}% saham (Rp ${v.amountIdr.toLocaleString("id-ID")})`,
        journalEntryId: journalResult.entryId,
        createdBy: session.user.id,
      });

      /* Update share_pct turun (sisa jadi treasury). */
      await tx
        .update(investors)
        .set({
          sharePct: sql`${investors.sharePct} - ${deltaStr}::numeric`,
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(eq(investors.id, v.fromInvestorId));

      /* Link journalEntryId. */
      await tx
        .update(shareTransactions)
        .set({ journalEntryId: journalResult.entryId })
        .where(eq(shareTransactions.id, stRow.id));

      return { ...stRow, journalEntryId: journalResult.entryId };
    });

    logAudit({
      eventType: "share_transaction.company_buyback",
      userId: session.user.id,
      entityType: "share_transaction",
      entityId: result.id,
      payload: {
        summary: `Buyback ${deltaStr}% saham ${fromInv.fullName} — Rp ${v.amountIdr.toLocaleString("id-ID")} via ${bankDestinationLabel}`,
        context: {
          fromInvestorId: v.fromInvestorId,
          sharePctDelta: deltaStr,
          amountIdr: v.amountIdr,
          bankAccountId: v.bankAccountId,
          journalEntryId: result.journalEntryId,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit share_transaction.buyback]", e));

    return ok(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("INVALID_DELTA:")) {
      const parts = msg.split(":");
      return fail(
        "INVALID_DELTA",
        `Investor ${parts[1]} hanya punya ${parts[2]}% share`,
        "sharePctDelta",
      );
    }
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "share_transaction.buyback", "Operasi database gagal"),
    );
  }
}

/**
 * Reverse share transaction (P2P atau Buyback).
 *
 * P2P reverse: swap from/to share back. No journal.
 * Buyback reverse: post Dr Bank / Cr 3401, restore share ke investor.
 */
export async function reverseShareTransaction(
  input: ReverseShareTransactionInput,
): Promise<ApiResult<{ id: string; journalEntryId: string | null }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "distribution.approve")) {
    return fail("FORBIDDEN", "Tidak punya hak reverse mutasi saham");
  }
  const parsed = reverseShareTransactionSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "",
    );
  }
  const v = parsed.data;

  const [st] = await db
    .select()
    .from(shareTransactions)
    .where(eq(shareTransactions.id, v.id))
    .limit(1);
  if (!st) return fail("NOT_FOUND", "Mutasi saham tidak ditemukan");
  if (st.outletId !== session.user.outletId) {
    return fail("FORBIDDEN", "Mutasi dari outlet lain");
  }
  if (st.status === "reversed") {
    return ok({ id: st.id, journalEntryId: st.journalEntryId ?? null });
  }
  if (st.status !== "posted") {
    return fail("INVALID_STATE", `Status ${st.status} tidak bisa reverse`);
  }

  const deltaStr = st.sharePctDelta;

  try {
    const result = await db.transaction(async (tx) => {
      await lockOutletDividenAdvisory(tx, session.user.outletId);

      if (st.kind === "p2p_transfer") {
        if (!st.fromInvestorId || !st.toInvestorId) {
          throw new Error("INVALID_P2P_DATA");
        }
        await lockInvestors(tx, [st.fromInvestorId, st.toInvestorId]);
        /* Swap back: to → from. */
        await tx
          .update(investors)
          .set({
            sharePct: sql`${investors.sharePct} + ${deltaStr}::numeric`,
            updatedAt: new Date(),
            updatedBy: session.user.id,
          })
          .where(eq(investors.id, st.fromInvestorId));
        await tx
          .update(investors)
          .set({
            sharePct: sql`${investors.sharePct} - ${deltaStr}::numeric`,
            updatedAt: new Date(),
            updatedBy: session.user.id,
          })
          .where(eq(investors.id, st.toInvestorId));
        await tx
          .update(shareTransactions)
          .set({
            status: "reversed",
            reversedAt: new Date(),
            reversedBy: session.user.id,
            reversalReason: v.reason,
          })
          .where(eq(shareTransactions.id, st.id));
        return { journalEntryId: null };
      }

      if (st.kind === "company_buyback") {
        if (!st.fromInvestorId || !st.bankAccountId) {
          throw new Error("INVALID_BUYBACK_DATA");
        }
        await lockInvestors(tx, [st.fromInvestorId]);
        await lockBankAccountAdvisory(tx, st.bankAccountId);

        const [investorRow] = await tx
          .select({ fullName: investors.fullName })
          .from(investors)
          .where(eq(investors.id, st.fromInvestorId))
          .limit(1);
        const [bankRow] = await tx
          .select({
            bankName: bankAccounts.bankName,
            accountName: bankAccounts.accountName,
            accountNumber: bankAccounts.accountNumber,
          })
          .from(bankAccounts)
          .where(eq(bankAccounts.id, st.bankAccountId))
          .limit(1);

        const bankAccountCode = bankRow
          ? resolveBankCodeFromBankName(bankRow.bankName)
          : "1112";
        const bankLabel = bankRow
          ? [
              bankRow.bankName,
              bankRow.accountName,
              bankRow.accountNumber && bankRow.accountNumber.length > 4
                ? `...${bankRow.accountNumber.slice(-4)}`
                : bankRow.accountNumber ?? "",
            ]
              .filter(Boolean)
              .join(" — ")
          : "(unknown bank)";

        const reverseLines = mapShareBuybackReversal({
          amount: st.amountIdr,
          bankAccountCode,
          bankDestinationLabel: bankLabel,
          investorName: investorRow?.fullName ?? "(unknown)",
          sharePctDelta: Number(deltaStr),
          reason: v.reason,
        });
        const journalResult = await recordJournal({
          outletId: session.user.outletId,
          entryDate: todayJakarta(),
          description: `Reversal buyback ${investorRow?.fullName ?? ""}: ${v.reason.slice(0, 100)}`,
          sourceType: "share_buyback_reversal",
          sourceId: st.id,
          lines: reverseLines,
          status: "posted",
          actorId: session.user.id,
          metadata: {
            shareTransactionId: st.id,
            reversalReason: v.reason,
          },
        });

        /* Restore share. */
        await tx
          .update(investors)
          .set({
            sharePct: sql`${investors.sharePct} + ${deltaStr}::numeric`,
            updatedAt: new Date(),
            updatedBy: session.user.id,
          })
          .where(eq(investors.id, st.fromInvestorId));
        await tx
          .update(shareTransactions)
          .set({
            status: "reversed",
            reversedAt: new Date(),
            reversedBy: session.user.id,
            reversalReason: v.reason,
          })
          .where(eq(shareTransactions.id, st.id));
        return { journalEntryId: journalResult.entryId };
      }

      throw new Error(`UNSUPPORTED_KIND:${st.kind}`);
    });

    logAudit({
      eventType: "share_transaction.reverse",
      userId: session.user.id,
      entityType: "share_transaction",
      entityId: st.id,
      payload: {
        summary: `Reverse ${st.kind} (${deltaStr}%): ${v.reason}`,
        context: {
          kind: st.kind,
          reversalReason: v.reason,
          journalEntryId: result.journalEntryId,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    }).catch((e) => console.error("[audit share_transaction.reverse]", e));

    return ok({ id: st.id, journalEntryId: result.journalEntryId });
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "share_transaction.reverse", "Operasi database gagal"),
    );
  }
}
