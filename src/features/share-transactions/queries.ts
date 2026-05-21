import "server-only";
import { aliasedTable, and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccounts,
  investors,
  shareTransactions,
  users,
} from "@/db/schema";
import type {
  ShareTransactionKind,
  ShareTransactionListRow,
} from "./types";

const fromInvestorAlias = aliasedTable(investors, "from_inv");
const toInvestorAlias = aliasedTable(investors, "to_inv");

export async function listShareTransactions(opts: {
  outletId: string;
  investorId?: string;
  kind?: ShareTransactionKind | "all";
  limit?: number;
}): Promise<ShareTransactionListRow[]> {
  const limit = Math.min(opts.limit ?? 200, 1000);
  const conds = [eq(shareTransactions.outletId, opts.outletId)];
  if (opts.kind && opts.kind !== "all") {
    conds.push(eq(shareTransactions.kind, opts.kind));
  }
  /* Investor filter: kalau di-set, filter rows yang ada investor di from
   * atau to. Sederhana: OR via 2 query? Cleaner: pakai SQL. Untuk
   * sekarang skip investor filter di query layer; caller filter di list. */

  const rows = await db
    .select({
      st: shareTransactions,
      fromName: fromInvestorAlias.fullName,
      toName: toInvestorAlias.fullName,
      bankName: bankAccounts.bankName,
      accountName: bankAccounts.accountName,
      accountNumber: bankAccounts.accountNumber,
      createdByName: users.name,
    })
    .from(shareTransactions)
    .leftJoin(
      fromInvestorAlias,
      eq(fromInvestorAlias.id, shareTransactions.fromInvestorId),
    )
    .leftJoin(
      toInvestorAlias,
      eq(toInvestorAlias.id, shareTransactions.toInvestorId),
    )
    .leftJoin(
      bankAccounts,
      eq(bankAccounts.id, shareTransactions.bankAccountId),
    )
    .leftJoin(users, eq(users.id, shareTransactions.createdBy))
    .where(and(...conds))
    .orderBy(desc(shareTransactions.occurredAt))
    .limit(limit);

  return rows
    .filter((r) => {
      if (!opts.investorId) return true;
      return (
        r.st.fromInvestorId === opts.investorId ||
        r.st.toInvestorId === opts.investorId
      );
    })
    .map((row) => {
      const numTail =
        row.accountNumber && row.accountNumber.length > 4
          ? `...${row.accountNumber.slice(-4)}`
          : row.accountNumber ?? "";
      const bankLabel = row.bankName
        ? [row.bankName, row.accountName, numTail].filter(Boolean).join(" — ")
        : null;
      return {
        id: row.st.id,
        kind: row.st.kind as ShareTransactionKind,
        fromInvestorId: row.st.fromInvestorId,
        fromInvestorName: row.fromName,
        toInvestorId: row.st.toInvestorId,
        toInvestorName: row.toName,
        sharePctDelta: row.st.sharePctDelta,
        amountIdr: row.st.amountIdr,
        bankAccountId: row.st.bankAccountId,
        bankLabel,
        occurredAt: row.st.occurredAt,
        description: row.st.description,
        status: row.st.status,
        journalEntryId: row.st.journalEntryId,
        reversedAt: row.st.reversedAt,
        reversalReason: row.st.reversalReason,
        createdAt: row.st.createdAt,
        createdByName: row.createdByName ?? null,
      };
    });
}
