import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccounts,
  expenseCategories,
  internalDebtEntries,
  internalDebtParties,
  internalDebtRepayments,
  users,
} from "@/db/schema";
import type {
  InternalDebtEntryListRow,
  InternalDebtParty,
  InternalDebtPartyListRow,
  InternalDebtRepaymentListRow,
} from "./types";

/**
 * Sesi AE-180 — Internal debt queries (mirror creditors/queries.ts pattern).
 */

function bankLabelOf(
  bankName: string | null,
  accountName: string | null,
  accountNumber: string | null,
): string {
  const numTail =
    accountNumber && accountNumber.length > 4
      ? `...${accountNumber.slice(-4)}`
      : accountNumber ?? "";
  return [bankName, accountName, numTail].filter(Boolean).join(" — ");
}

export async function listInternalDebtParties(opts: {
  outletId: string;
  status?: "active" | "settled" | "all";
}): Promise<InternalDebtPartyListRow[]> {
  const conds = [
    eq(internalDebtParties.outletId, opts.outletId),
    isNull(internalDebtParties.deletedAt),
  ];
  if (opts.status === "active") {
    conds.push(sql`${internalDebtParties.totalOutstanding} > 0`);
  } else if (opts.status === "settled") {
    conds.push(eq(internalDebtParties.totalOutstanding, 0));
  }

  const partyRows = await db
    .select()
    .from(internalDebtParties)
    .where(and(...conds))
    .orderBy(
      desc(internalDebtParties.totalOutstanding),
      desc(internalDebtParties.createdAt),
    );

  if (partyRows.length === 0) return [];
  const partyIds = partyRows.map((p) => p.id);

  const entryAggs = await db
    .select({
      partyId: internalDebtEntries.partyId,
      sumAmount: sql<number>`SUM(${internalDebtEntries.amount})::bigint`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(internalDebtEntries)
    .where(
      and(
        inArray(internalDebtEntries.partyId, partyIds),
        eq(internalDebtEntries.status, "posted"),
      ),
    )
    .groupBy(internalDebtEntries.partyId);

  const repayAggs = await db
    .select({
      partyId: internalDebtRepayments.partyId,
      sumAmount: sql<number>`SUM(${internalDebtRepayments.amount})::bigint`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(internalDebtRepayments)
    .where(
      and(
        inArray(internalDebtRepayments.partyId, partyIds),
        eq(internalDebtRepayments.status, "posted"),
      ),
    )
    .groupBy(internalDebtRepayments.partyId);

  const entryMap = new Map(
    entryAggs.map((a) => [
      a.partyId,
      { totalDebt: Number(a.sumAmount ?? 0), entryCount: a.count },
    ]),
  );
  const repayMap = new Map(
    repayAggs.map((a) => [
      a.partyId,
      { totalRepaid: Number(a.sumAmount ?? 0), repaymentCount: a.count },
    ]),
  );

  return partyRows.map((p) => ({
    ...p,
    totalDebt: entryMap.get(p.id)?.totalDebt ?? 0,
    entryCount: entryMap.get(p.id)?.entryCount ?? 0,
    totalRepaid: repayMap.get(p.id)?.totalRepaid ?? 0,
    repaymentCount: repayMap.get(p.id)?.repaymentCount ?? 0,
  }));
}

export async function fetchInternalDebtPartyById(
  outletId: string,
  id: string,
): Promise<InternalDebtParty | null> {
  const [row] = await db
    .select()
    .from(internalDebtParties)
    .where(
      and(
        eq(internalDebtParties.id, id),
        eq(internalDebtParties.outletId, outletId),
        isNull(internalDebtParties.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listInternalDebtEntries(opts: {
  outletId: string;
  partyId?: string;
  limit?: number;
}): Promise<InternalDebtEntryListRow[]> {
  const limit = Math.min(opts.limit ?? 200, 1000);
  const conds = [eq(internalDebtEntries.outletId, opts.outletId)];
  if (opts.partyId) {
    conds.push(eq(internalDebtEntries.partyId, opts.partyId));
  }
  const rows = await db
    .select({
      e: internalDebtEntries,
      partyName: internalDebtParties.name,
      categoryName: expenseCategories.name,
      bankName: bankAccounts.bankName,
      accountName: bankAccounts.accountName,
      accountNumber: bankAccounts.accountNumber,
      createdByName: users.name,
    })
    .from(internalDebtEntries)
    .leftJoin(
      internalDebtParties,
      eq(internalDebtParties.id, internalDebtEntries.partyId),
    )
    .leftJoin(
      expenseCategories,
      eq(expenseCategories.id, internalDebtEntries.categoryId),
    )
    .leftJoin(
      bankAccounts,
      eq(bankAccounts.id, internalDebtEntries.bankAccountId),
    )
    .leftJoin(users, eq(users.id, internalDebtEntries.createdBy))
    .where(and(...conds))
    .orderBy(desc(internalDebtEntries.occurredAt))
    .limit(limit);

  return rows.map((row) => ({
    ...row.e,
    partyName: row.partyName ?? "(unknown)",
    categoryName: row.categoryName ?? null,
    bankLabel: row.bankName
      ? bankLabelOf(row.bankName, row.accountName, row.accountNumber)
      : null,
    createdByName: row.createdByName ?? null,
  }));
}

export async function listInternalDebtRepayments(opts: {
  outletId: string;
  partyId?: string;
  limit?: number;
}): Promise<InternalDebtRepaymentListRow[]> {
  const limit = Math.min(opts.limit ?? 200, 1000);
  const conds = [eq(internalDebtRepayments.outletId, opts.outletId)];
  if (opts.partyId) {
    conds.push(eq(internalDebtRepayments.partyId, opts.partyId));
  }
  const rows = await db
    .select({
      r: internalDebtRepayments,
      partyName: internalDebtParties.name,
      bankName: bankAccounts.bankName,
      accountName: bankAccounts.accountName,
      accountNumber: bankAccounts.accountNumber,
      createdByName: users.name,
    })
    .from(internalDebtRepayments)
    .leftJoin(
      internalDebtParties,
      eq(internalDebtParties.id, internalDebtRepayments.partyId),
    )
    .leftJoin(
      bankAccounts,
      eq(bankAccounts.id, internalDebtRepayments.bankAccountId),
    )
    .leftJoin(users, eq(users.id, internalDebtRepayments.createdBy))
    .where(and(...conds))
    .orderBy(desc(internalDebtRepayments.occurredAt))
    .limit(limit);

  return rows.map((row) => ({
    ...row.r,
    partyName: row.partyName ?? "(unknown)",
    bankLabel: bankLabelOf(row.bankName, row.accountName, row.accountNumber),
    createdByName: row.createdByName ?? null,
  }));
}
