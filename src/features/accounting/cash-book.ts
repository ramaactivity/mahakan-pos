import "server-only";
import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { chartOfAccounts, journalEntries, journalLines } from "@/db/schema";
import { clampFromDate, getCutoffDate } from "@/features/cutoff/cutoff";
import { getAccountOpeningBalance } from "./queries";
import {
  buildCashBook,
  CASH_BANK_CODE_SQL_REGEX,
  type CashBook,
  type CashBookAccount,
} from "./cash-book-pure";

/** Akun kas & bank aktif outlet ini, urut kode. */
export async function fetchCashBankAccounts(outletId: string): Promise<CashBookAccount[]> {
  return db
    .select({ id: chartOfAccounts.id, code: chartOfAccounts.code, name: chartOfAccounts.name })
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.outletId, outletId),
        isNull(chartOfAccounts.deletedAt),
        eq(chartOfAccounts.isActive, true),
        sql`${chartOfAccounts.code} ~ ${CASH_BANK_CODE_SQL_REGEX}`,
      ),
    )
    .orderBy(asc(chartOfAccounts.code));
}

/**
 * Sesi AE-239 — Buku Kas satu akun (atau semua kas & bank).
 * Mengikuti batas buku (AE-207) persis seperti Buku Besar. Saldo awal dan
 * daftar baris memakai tanggal mulai YANG SAMA (sesudah dipotong batas
 * buku), supaya entry Saldo Awal di tanggal itu masuk tepat sekali.
 */
export async function fetchCashBook(args: {
  outletId: string;
  /** undefined = buku pertama (Kas laci); null = semua kas & bank. */
  accountId: string | null | undefined;
  from: string;
  to: string;
}): Promise<CashBook | null> {
  const accounts = await fetchCashBankAccounts(args.outletId);
  const accountId = args.accountId === undefined ? (accounts[0]?.id ?? null) : args.accountId;
  if (accountId && !accounts.some((a) => a.id === accountId)) return null;
  const ids = accountId ? [accountId] : accounts.map((a) => a.id);
  if (ids.length === 0) {
    return buildCashBook({ accounts, accountId: null, from: args.from, to: args.to, openingBalance: 0, raw: [] });
  }

  const from = clampFromDate(args.from, await getCutoffDate(args.outletId)) as string;

  const openings = await Promise.all(
    ids.map((accountId) =>
      getAccountOpeningBalance({ outletId: args.outletId, accountId, beforeDate: from }),
    ),
  );
  const openingBalance = openings.reduce((s, n) => s + n, 0);

  const rows =
    from > args.to
      ? []
      : await db
          .select({
            entryId: journalEntries.id,
            entryNumber: journalEntries.entryNumber,
            entryDate: journalEntries.entryDate,
            sourceType: journalEntries.sourceType,
            description: journalEntries.description,
            lineDescription: journalLines.description,
            accountId: journalLines.accountId,
            accountCode: chartOfAccounts.code,
            accountName: chartOfAccounts.name,
            debit: journalLines.debit,
            credit: journalLines.credit,
          })
          .from(journalLines)
          .innerJoin(
            journalEntries,
            and(
              eq(journalEntries.id, journalLines.entryId),
              eq(journalEntries.outletId, args.outletId),
              eq(journalEntries.status, "posted"),
              gte(journalEntries.entryDate, from),
              lte(journalEntries.entryDate, args.to),
              /* Pasangan aturan getAccountOpeningBalance (AE-212). */
              sql`NOT (${journalEntries.entryDate} = ${from}
                       AND ${journalEntries.sourceType} = 'opening_balance')`,
            ),
          )
          .innerJoin(chartOfAccounts, eq(chartOfAccounts.id, journalLines.accountId))
          .where(inArray(journalLines.accountId, ids))
          .orderBy(
            asc(journalEntries.entryDate),
            asc(journalEntries.createdAt),
            asc(journalEntries.entryNumber),
          );

  const entryIds = [...new Set(rows.map((r) => r.entryId))];
  const allLines =
    entryIds.length === 0
      ? []
      : await db
          .select({
            entryId: journalLines.entryId,
            accountId: journalLines.accountId,
            code: chartOfAccounts.code,
            name: chartOfAccounts.name,
            debit: journalLines.debit,
            credit: journalLines.credit,
          })
          .from(journalLines)
          .innerJoin(chartOfAccounts, eq(chartOfAccounts.id, journalLines.accountId))
          .where(inArray(journalLines.entryId, entryIds));
  const linesByEntry = new Map<string, typeof allLines>();
  for (const l of allLines) {
    const list = linesByEntry.get(l.entryId) ?? [];
    list.push(l);
    linesByEntry.set(l.entryId, list);
  }

  return buildCashBook({
    accounts,
    accountId,
    from: args.from,
    to: args.to,
    openingBalance,
    raw: rows.map((r) => ({
      entryId: r.entryId,
      entryNumber: r.entryNumber,
      entryDate: String(r.entryDate),
      sourceType: r.sourceType,
      description: r.description,
      lineDescription: r.lineDescription,
      accountId: r.accountId,
      accountCode: r.accountCode,
      accountName: r.accountName,
      debit: Number(r.debit),
      credit: Number(r.credit),
      entryLines: (linesByEntry.get(r.entryId) ?? []).map((l) => ({
        accountId: l.accountId,
        code: l.code,
        name: l.name,
        debit: Number(l.debit),
        credit: Number(l.credit),
      })),
    })),
  });
}
