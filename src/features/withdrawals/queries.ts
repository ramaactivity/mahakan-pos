import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccounts,
  investors,
  users,
  withdrawalRequests,
} from "@/db/schema";
import type { WithdrawalListRow } from "./types";

/**
 * Sesi AE-80 — Queries untuk Tab Saldo & Pencairan.
 *
 * listWithdrawals: paginated list per outlet + optional filter investor.
 * Joined dengan investor.fullName + bank label + creator name.
 */

export async function listWithdrawals(opts: {
  outletId: string;
  investorId?: string;
  /** Default 100; max 500. */
  limit?: number;
}): Promise<WithdrawalListRow[]> {
  const limit = Math.min(opts.limit ?? 100, 500);
  const conds = [eq(withdrawalRequests.outletId, opts.outletId)];
  if (opts.investorId) {
    conds.push(eq(withdrawalRequests.investorId, opts.investorId));
  }
  const rows = await db
    .select({
      id: withdrawalRequests.id,
      investorId: withdrawalRequests.investorId,
      investorName: investors.fullName,
      amount: withdrawalRequests.amount,
      bankAccountId: withdrawalRequests.bankAccountId,
      bankName: bankAccounts.bankName,
      bankAccountNumber: bankAccounts.accountNumber,
      accountName: bankAccounts.accountName,
      occurredAt: withdrawalRequests.occurredAt,
      status: withdrawalRequests.status,
      reversedAt: withdrawalRequests.reversedAt,
      reversedBy: withdrawalRequests.reversedBy,
      reversalReason: withdrawalRequests.reversalReason,
      journalEntryId: withdrawalRequests.journalEntryId,
      createdAt: withdrawalRequests.createdAt,
      createdByName: users.name,
    })
    .from(withdrawalRequests)
    .leftJoin(investors, eq(investors.id, withdrawalRequests.investorId))
    .leftJoin(
      bankAccounts,
      eq(bankAccounts.id, withdrawalRequests.bankAccountId),
    )
    .leftJoin(users, eq(users.id, withdrawalRequests.createdBy))
    .where(and(...conds))
    .orderBy(desc(withdrawalRequests.occurredAt))
    .limit(limit);

  return rows.map((r) => {
    const numTail =
      r.bankAccountNumber && r.bankAccountNumber.length > 4
        ? `...${r.bankAccountNumber.slice(-4)}`
        : r.bankAccountNumber ?? "";
    const bankLabel = [r.bankName, r.accountName, numTail]
      .filter(Boolean)
      .join(" — ");
    return {
      id: r.id,
      investorId: r.investorId,
      investorName: r.investorName ?? "(unknown)",
      amount: r.amount,
      bankAccountId: r.bankAccountId,
      bankLabel,
      occurredAt: r.occurredAt,
      status: r.status,
      reversedAt: r.reversedAt,
      reversedBy: r.reversedBy,
      reversalReason: r.reversalReason,
      journalEntryId: r.journalEntryId,
      createdAt: r.createdAt,
      createdByName: r.createdByName ?? null,
    };
  });
}

/**
 * Sum agregat per investor untuk display di Tab Saldo
 * (total ditarik lifetime).
 */
export async function getWithdrawalSumByInvestor(opts: {
  outletId: string;
  investorIds: string[];
}): Promise<Map<string, number>> {
  if (opts.investorIds.length === 0) return new Map();
  const rows = await db
    .select({
      investorId: withdrawalRequests.investorId,
      sumAmount: sql<number>`SUM(${withdrawalRequests.amount})::bigint`,
    })
    .from(withdrawalRequests)
    .where(
      and(
        eq(withdrawalRequests.outletId, opts.outletId),
        eq(withdrawalRequests.status, "posted"),
        /* Sesi AE-76 pattern — pakai inArray helper, BUKAN sql`= ANY()`
         * yang tidak reliable di Neon serverless. */
        inArray(withdrawalRequests.investorId, opts.investorIds),
      ),
    )
    .groupBy(withdrawalRequests.investorId);

  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.investorId, Number(r.sumAmount ?? 0));
  }
  return map;
}
