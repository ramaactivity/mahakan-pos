import "server-only";

import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountingPeriods,
  chartOfAccounts,
  journalEntries,
  journalLines,
} from "@/db/schema";
import type {
  AccountListRow,
  AccountType,
  AccountingPeriod,
  JournalEntryWithLines,
  PeriodStatus,
  PeriodSummary,
} from "./types";

// ---------- Chart of Accounts ----------

export async function listAccounts(
  outletId: string,
  filters?: {
    type?: AccountType;
    isActive?: boolean;
    includeDeleted?: boolean;
  },
): Promise<AccountListRow[]> {
  const conditions = [eq(chartOfAccounts.outletId, outletId)];
  if (!filters?.includeDeleted) {
    conditions.push(isNull(chartOfAccounts.deletedAt));
  }
  if (filters?.type) {
    conditions.push(eq(chartOfAccounts.type, filters.type));
  }
  if (typeof filters?.isActive === "boolean") {
    conditions.push(eq(chartOfAccounts.isActive, filters.isActive));
  }

  return db
    .select()
    .from(chartOfAccounts)
    .where(and(...conditions))
    .orderBy(asc(chartOfAccounts.displayOrder), asc(chartOfAccounts.code));
}

export async function getAccountById(
  outletId: string,
  id: string,
): Promise<AccountListRow | null> {
  const [row] = await db
    .select()
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.id, id),
        eq(chartOfAccounts.outletId, outletId),
        isNull(chartOfAccounts.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getAccountByCode(
  outletId: string,
  code: string,
): Promise<AccountListRow | null> {
  const [row] = await db
    .select()
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.outletId, outletId),
        eq(chartOfAccounts.code, code),
        isNull(chartOfAccounts.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

// ---------- Periods ----------

export async function listPeriods(outletId: string): Promise<PeriodSummary[]> {
  const rows = await db
    .select({
      period: accountingPeriods,
      entryCount: count(journalEntries.id).as("entry_count"),
    })
    .from(accountingPeriods)
    .leftJoin(
      journalEntries,
      and(
        eq(journalEntries.periodId, accountingPeriods.id),
        sql`${journalEntries.status} <> 'reversed'`,
      ),
    )
    .where(eq(accountingPeriods.outletId, outletId))
    .groupBy(accountingPeriods.id)
    .orderBy(
      desc(accountingPeriods.periodYear),
      desc(accountingPeriods.periodMonth),
    );

  return rows.map((r) => ({
    ...r.period,
    entryCount: Number(r.entryCount),
  }));
}

export async function getPeriodById(
  outletId: string,
  id: string,
): Promise<AccountingPeriod | null> {
  const [row] = await db
    .select()
    .from(accountingPeriods)
    .where(
      and(eq(accountingPeriods.id, id), eq(accountingPeriods.outletId, outletId)),
    )
    .limit(1);
  return row ?? null;
}

export async function getPeriodByYearMonth(
  outletId: string,
  year: number,
  month: number,
): Promise<AccountingPeriod | null> {
  const [row] = await db
    .select()
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.outletId, outletId),
        eq(accountingPeriods.periodYear, year),
        eq(accountingPeriods.periodMonth, month),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Get current period (Jakarta calendar). Returns null kalau belum di-create.
 * Caller sesi T+ akan auto-create on demand; sesi S read-only saja.
 */
export async function getCurrentPeriod(
  outletId: string,
  now: Date = new Date(),
): Promise<AccountingPeriod | null> {
  // WIB is UTC+7, no DST. Compute Jakarta year-month from input date.
  const jakartaTimeMs = now.getTime() + 7 * 60 * 60 * 1000;
  const j = new Date(jakartaTimeMs);
  const year = j.getUTCFullYear();
  const month = j.getUTCMonth() + 1; // 1-12
  return getPeriodByYearMonth(outletId, year, month);
}

// ---------- Journal Entries ----------

export async function listJournalEntries(
  outletId: string,
  filters?: {
    periodId?: string;
    status?: "draft" | "posted" | "reversed";
    limit?: number;
    offset?: number;
  },
): Promise<JournalEntryWithLines[]> {
  const conditions = [eq(journalEntries.outletId, outletId)];
  if (filters?.periodId) {
    conditions.push(eq(journalEntries.periodId, filters.periodId));
  }
  if (filters?.status) {
    conditions.push(eq(journalEntries.status, filters.status));
  }

  const limit = filters?.limit ?? 100;
  const offset = filters?.offset ?? 0;

  const entries = await db
    .select()
    .from(journalEntries)
    .where(and(...conditions))
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.entryNumber))
    .limit(limit)
    .offset(offset);

  if (entries.length === 0) return [];

  const entryIds = entries.map((e) => e.id);
  const lines = await db
    .select({
      line: journalLines,
      accountCode: chartOfAccounts.code,
      accountName: chartOfAccounts.name,
    })
    .from(journalLines)
    .innerJoin(chartOfAccounts, eq(journalLines.accountId, chartOfAccounts.id))
    .where(sql`${journalLines.entryId} = ANY(${entryIds})`)
    .orderBy(asc(journalLines.entryId), asc(journalLines.lineNumber));

  const linesByEntry = new Map<string, JournalEntryWithLines["lines"]>();
  for (const r of lines) {
    const list = linesByEntry.get(r.line.entryId) ?? [];
    list.push({
      ...r.line,
      accountCode: r.accountCode,
      accountName: r.accountName,
    });
    linesByEntry.set(r.line.entryId, list);
  }

  return entries.map((e) => ({
    ...e,
    lines: linesByEntry.get(e.id) ?? [],
    number: e.entryNumber,
  }));
}

export async function getJournalEntryById(
  outletId: string,
  id: string,
): Promise<JournalEntryWithLines | null> {
  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(
      and(eq(journalEntries.id, id), eq(journalEntries.outletId, outletId)),
    )
    .limit(1);
  if (!entry) return null;

  const lines = await db
    .select({
      line: journalLines,
      accountCode: chartOfAccounts.code,
      accountName: chartOfAccounts.name,
    })
    .from(journalLines)
    .innerJoin(chartOfAccounts, eq(journalLines.accountId, chartOfAccounts.id))
    .where(eq(journalLines.entryId, id))
    .orderBy(asc(journalLines.lineNumber));

  return {
    ...entry,
    lines: lines.map((l) => ({
      ...l.line,
      accountCode: l.accountCode,
      accountName: l.accountName,
    })),
    number: entry.entryNumber,
  };
}

export async function countJournalEntriesByPeriod(
  outletId: string,
  periodId: string,
): Promise<{ posted: number; draft: number; reversed: number }> {
  const rows = await db
    .select({
      status: journalEntries.status,
      total: count(journalEntries.id).as("total"),
    })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.outletId, outletId),
        eq(journalEntries.periodId, periodId),
      ),
    )
    .groupBy(journalEntries.status);

  let posted = 0;
  let draft = 0;
  let reversed = 0;
  for (const r of rows) {
    const n = Number(r.total);
    if (r.status === "posted") posted = n;
    else if (r.status === "draft") draft = n;
    else if (r.status === "reversed") reversed = n;
  }
  return { posted, draft, reversed };
}

export async function listPeriodStatuses(
  outletId: string,
): Promise<{ id: string; year: number; month: number; status: PeriodStatus }[]> {
  return db
    .select({
      id: accountingPeriods.id,
      year: accountingPeriods.periodYear,
      month: accountingPeriods.periodMonth,
      status: accountingPeriods.status,
    })
    .from(accountingPeriods)
    .where(eq(accountingPeriods.outletId, outletId))
    .orderBy(
      desc(accountingPeriods.periodYear),
      desc(accountingPeriods.periodMonth),
    );
}
