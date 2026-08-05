import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
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
import type {
  AccountBalanceRow,
  CashFlowEntryAggregate,
} from "./reports";

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
    sourceType?: string;
    fromDate?: string; // YYYY-MM-DD inclusive
    toDate?: string; // YYYY-MM-DD inclusive
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
  if (filters?.sourceType) {
    conditions.push(
      eq(
        journalEntries.sourceType,
        filters.sourceType as
          | "manual"
          | "opening_balance"
          | "pos_sale"
          | "pos_refund"
          | "pos_compliment"
          | "purchase_create"
          | "purchase_pay"
          | "purchase_cancel"
          | "payroll_paid"
          | "expense_create"
          | "expense_void"
          | "income_create"
          | "income_void"
          | "cash_deposit_verified"
          | "aggregator_settlement"
          | "shift_variance"
          | "opname_adjustment"
          | "period_close"
          | "period_reopen",
      ),
    );
  }
  if (filters?.fromDate) {
    conditions.push(gte(journalEntries.entryDate, filters.fromDate));
  }
  if (filters?.toDate) {
    conditions.push(lte(journalEntries.entryDate, filters.toDate));
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
    .where(inArray(journalLines.entryId, entryIds))
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

// ============================================================
// Reports — balance aggregation
// ============================================================

/**
 * Aggregate journal_lines per account untuk all entries within range, status='posted'.
 * Used by Trial Balance, Income Statement, and Balance Sheet (entry_date <= asOf).
 *
 * `fromDate` null = from beginning of time (untuk balance sheet as-of pattern).
 * `toDate` inclusive (entry_date <= toDate).
 *
 * ⚠️ Sesi AE-183 — PERBAIKAN BUG SERIUS. Syarat periode + status ada di klausa
 * ON milik LEFT JOIN ke journal_entries. Pada LEFT JOIN, baris journal_lines
 * yang entry-nya TIDAK memenuhi syarat tetap ikut keluar (kolom entry jadi
 * NULL) — dan nilai debit/kredit-nya tetap terjumlah. Akibatnya filter tanggal
 * TIDAK BEKERJA SAMA SEKALI: berapa pun periode yang dipilih, fungsi ini
 * mengembalikan total sepanjang masa.
 *
 * Terbukti di produksi 2026-08-05 untuk akun 4101 (Penjualan Makanan):
 *   Juli saja      → 11.656.000  (seharusnya 3.671.000)
 *   s/d 30 Juni    → 11.656.000  (seharusnya 7.388.000)
 *   Mei saja       → 11.656.000  (seharusnya 2.700.000)
 *   sepanjang masa → 11.656.000  ✓ (cuma ini yang kebetulan benar)
 *
 * Dampaknya kena SEMUA laporan yang memakai fungsi ini: Trial Balance, Laba
 * Rugi, Neraca, dan Validasi Drift — semuanya menampilkan angka sepanjang masa
 * berapa pun periode yang dipilih owner.
 *
 * Perbaikannya: LEFT JOIN dipertahankan (supaya akun tanpa mutasi tetap muncul
 * sebagai 0), tapi penjumlahan hanya menghitung baris yang join-nya BERHASIL —
 * `journal_entries.id IS NOT NULL` berarti entry-nya lolos semua syarat ON.
 */
export async function getAccountBalances(args: {
  outletId: string;
  fromDate: string | null;
  toDate: string;
  /** Audit AE-186 — laporan BER-JENDELA periode (Laba Rugi, Trial Balance
   * per bulan, laba utk distribusi) wajib mengecualikan closing entry.
   * Closing entry menyapu seluruh revenue/HPP/beban bulan itu ke laba
   * ditahan; kalau ikut kehitung, Laba Rugi bulan yang sudah di-close
   * kolaps jadi ~Rp 0. (Bug ini tak terlihat sebelum AE-183 karena filter
   * periodenya memang mati.) Neraca/kumulatif JANGAN pakai flag ini —
   * justru butuh closing entry supaya laba ditahan benar. */
  excludeClosingEntries?: boolean;
}): Promise<AccountBalanceRow[]> {
  const conditions = [
    eq(journalEntries.outletId, args.outletId),
    eq(journalEntries.status, "posted"),
    lte(journalEntries.entryDate, args.toDate),
  ];
  if (args.fromDate) {
    conditions.push(gte(journalEntries.entryDate, args.fromDate));
  }
  if (args.excludeClosingEntries) {
    conditions.push(
      sql`${journalEntries.sourceType} NOT IN ('period_close', 'period_reopen')`,
    );
  }

  const rows = await db
    .select({
      accountId: chartOfAccounts.id,
      code: chartOfAccounts.code,
      name: chartOfAccounts.name,
      type: chartOfAccounts.type,
      normalBalance: chartOfAccounts.normalBalance,
      isContra: chartOfAccounts.isContra,
      parentCode: chartOfAccounts.parentCode,
      debitTotal: sql<string>`COALESCE(SUM(CASE WHEN ${journalEntries.id} IS NOT NULL THEN ${journalLines.debit} ELSE 0 END), 0)`,
      creditTotal: sql<string>`COALESCE(SUM(CASE WHEN ${journalEntries.id} IS NOT NULL THEN ${journalLines.credit} ELSE 0 END), 0)`,
    })
    .from(chartOfAccounts)
    .leftJoin(journalLines, eq(journalLines.accountId, chartOfAccounts.id))
    .leftJoin(
      journalEntries,
      and(
        eq(journalEntries.id, journalLines.entryId),
        ...conditions,
      ),
    )
    .where(
      and(
        eq(chartOfAccounts.outletId, args.outletId),
        isNull(chartOfAccounts.deletedAt),
      ),
    )
    .groupBy(chartOfAccounts.id);

  return rows.map((r) => ({
    accountId: r.accountId,
    code: r.code,
    name: r.name,
    type: r.type as AccountBalanceRow["type"],
    normalBalance: r.normalBalance as AccountBalanceRow["normalBalance"],
    isContra: r.isContra,
    parentCode: r.parentCode,
    debitTotal: Number(r.debitTotal),
    creditTotal: Number(r.creditTotal),
  }));
}

/**
 * General Ledger entries untuk single account dalam range. Returns raw lines
 * dengan parent entry context (number, date, description). Caller passes ke
 * buildGeneralLedger() pure compute untuk running balance.
 */
export async function getAccountLedgerEntries(args: {
  outletId: string;
  accountId: string;
  fromDate: string;
  toDate: string;
}): Promise<
  Array<{
    entryNumber: string;
    entryDate: string;
    entryDescription: string;
    lineDescription: string | null;
    debit: number;
    credit: number;
  }>
> {
  const rows = await db
    .select({
      entryNumber: journalEntries.entryNumber,
      entryDate: journalEntries.entryDate,
      entryDescription: journalEntries.description,
      lineDescription: journalLines.description,
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
        gte(journalEntries.entryDate, args.fromDate),
        lte(journalEntries.entryDate, args.toDate),
      ),
    )
    .where(eq(journalLines.accountId, args.accountId))
    .orderBy(asc(journalEntries.entryDate), asc(journalEntries.entryNumber));

  return rows.map((r) => ({
    entryNumber: r.entryNumber,
    entryDate: String(r.entryDate),
    entryDescription: r.entryDescription,
    lineDescription: r.lineDescription,
    debit: Number(r.debit),
    credit: Number(r.credit),
  }));
}

// ============================================================
// Cash Flow Statement query
// ============================================================

/**
 * Aggregate cash impact per (sourceType, manual-classification) ke bucket
 * format yang `buildCashFlowStatement` consume.
 *
 * Strategy:
 *   1. Pull all journal entries dengan status='posted' di range
 *   2. Untuk entries yang touch cash/bank account (1101, 1102, 1110-1112),
 *      compute net cash impact (sum debit - sum credit pada cash lines)
 *   3. For sourceType='manual': inspect non-cash lines untuk classify investing
 *      (touches 1201-1204) atau financing (touches 3101/3201/3301) atau
 *      operating (else)
 *   4. Aggregate per (bucket, label) → array sesuai CashFlowEntryAggregate
 */
const CASH_BANK_CODES = ["1101", "1102", "1110", "1111", "1112"];
const FIXED_ASSET_CODES = ["1201", "1202", "1203", "1204"];
const EQUITY_CODES = ["3101", "3201", "3301"];

export async function getCashFlowEntries(args: {
  outletId: string;
  fromDate: string;
  toDate: string;
}): Promise<CashFlowEntryAggregate[]> {
  // Step 1 — entries dengan cash impact, plus aggregated cash net per entry.
  // Use raw SQL untuk klausul kompleks (nested aggregation + LEFT JOIN).
  const rows = await db.execute<{
    entry_id: string;
    source_type: string;
    cash_net: string;
    has_fixed_asset: boolean;
    has_equity: boolean;
  }>(sql`
    WITH cash_impact AS (
      SELECT
        je.id AS entry_id,
        je.source_type,
        SUM(jl.debit - jl.credit) AS cash_net
      FROM journal_entries je
      INNER JOIN journal_lines jl ON jl.entry_id = je.id
      INNER JOIN chart_of_accounts coa ON coa.id = jl.account_id
      WHERE je.outlet_id = ${args.outletId}
        AND je.status = 'posted'
        AND je.entry_date >= ${args.fromDate}
        AND je.entry_date <= ${args.toDate}
        AND coa.code IN ('1101','1102','1110','1111','1112')
      GROUP BY je.id, je.source_type
      HAVING SUM(jl.debit - jl.credit) != 0
    )
    SELECT
      ci.entry_id,
      ci.source_type,
      ci.cash_net::text AS cash_net,
      EXISTS (
        SELECT 1 FROM journal_lines jl2
        INNER JOIN chart_of_accounts coa2 ON coa2.id = jl2.account_id
        WHERE jl2.entry_id = ci.entry_id
          AND coa2.code IN ('1201','1202','1203','1204')
      ) AS has_fixed_asset,
      EXISTS (
        SELECT 1 FROM journal_lines jl3
        INNER JOIN chart_of_accounts coa3 ON coa3.id = jl3.account_id
        WHERE jl3.entry_id = ci.entry_id
          AND coa3.code IN ('3101','3201','3301')
      ) AS has_equity
    FROM cash_impact ci
  `);

  // Step 2 — aggregate ke buckets.
  const aggMap = new Map<
    string,
    { bucket: "operating" | "investing" | "financing"; label: string; amount: number; entryCount: number }
  >();

  // Drizzle execute returns { rows: [...] } shape — handle both.
  const rowsList = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
  const arr = Array.isArray(rowsList) ? rowsList : [];

  for (const r of arr) {
    const row = r as {
      entry_id: string;
      source_type: string;
      cash_net: string;
      has_fixed_asset: boolean;
      has_equity: boolean;
    };
    const sourceType = row.source_type;
    const amount = Number(row.cash_net);

    // Classify
    let bucket: "operating" | "investing" | "financing" | "skip";
    let label: string;
    if (sourceType === "manual") {
      if (row.has_fixed_asset) {
        bucket = "investing";
        label = "Fixed Asset Capitalization";
      } else if (row.has_equity) {
        bucket = "financing";
        label = "Owner Modal / Prive";
      } else {
        bucket = "operating";
        label = "Manual Journal (Operating)";
      }
    } else {
      const cls = classifyCashFlowSourceTypeImpl(sourceType);
      if (cls === "skip") continue;
      bucket = cls;
      label = SOURCE_LABELS_CF[sourceType] ?? sourceType;
    }

    const key = `${bucket}|${label}`;
    const existing = aggMap.get(key);
    if (existing) {
      existing.amount += amount;
      existing.entryCount += 1;
    } else {
      aggMap.set(key, { bucket, label, amount, entryCount: 1 });
    }
  }

  return Array.from(aggMap.values());
}

// Local copy untuk avoid circular import dengan reports.ts (server-only).
const SOURCE_LABELS_CF: Record<string, string> = {
  pos_sale: "POS Cash Sales",
  pos_refund: "Refund Payouts",
  purchase_create: "Purchase Payments (cash)",
  purchase_pay: "Purchase Payments (TOP paid)",
  purchase_cancel: "Purchase Cancellation",
  payroll_paid: "Payroll Payments",
  expense_create: "Operating Expenses",
  income_create: "Non-POS Income",
  aggregator_settlement: "Aggregator Settlements",
  shift_variance: "Shift Cash Variance",
};

function classifyCashFlowSourceTypeImpl(
  sourceType: string,
): "operating" | "investing" | "financing" | "skip" {
  switch (sourceType) {
    case "pos_sale":
    case "pos_refund":
    case "purchase_create":
    case "purchase_pay":
    case "purchase_cancel":
    case "payroll_paid":
    case "expense_create":
    case "income_create":
    case "aggregator_settlement":
    case "shift_variance":
      return "operating";
    case "cash_deposit_verified":
    case "pos_compliment":
    case "opname_adjustment":
    case "period_close":
    case "period_reopen":
    case "opening_balance":
    case "expense_void":
    case "income_void":
      return "skip";
    default:
      return "operating";
  }
}

/**
 * Opening balance untuk single account sampai (exclusive) `beforeDate`.
 * Sum of debit - sum of credit dari semua posted entries dengan
 * entry_date < beforeDate. Raw signed (caller normalizes per normalBalance).
 */
export async function getAccountOpeningBalance(args: {
  outletId: string;
  accountId: string;
  beforeDate: string;
}): Promise<number> {
  const [r] = await db
    .select({
      debitTotal: sql<string>`COALESCE(SUM(${journalLines.debit}), 0)`,
      creditTotal: sql<string>`COALESCE(SUM(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(
      journalEntries,
      and(
        eq(journalEntries.id, journalLines.entryId),
        eq(journalEntries.outletId, args.outletId),
        eq(journalEntries.status, "posted"),
        sql`${journalEntries.entryDate} < ${args.beforeDate}`,
      ),
    )
    .where(eq(journalLines.accountId, args.accountId));

  return Number(r?.debitTotal ?? 0) - Number(r?.creditTotal ?? 0);
}
