import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountingPeriods,
  chartOfAccounts,
  journalEntries,
  journalLines,
} from "@/db/schema";
import type { JournalSourceType } from "./types";

/**
 * Sesi T — `recordJournal` is the single entrypoint for all auto-journal +
 * manual journal posting. TX-atomic, idempotent, balanced.
 *
 * Idempotency: per (outletId, sourceType, sourceId), at most 1 active entry
 * (status IN ('posted','draft')). On retry returns existing entry id without
 * creating duplicate.
 *
 * Balance: throws "JOURNAL_IMBALANCED" if sum(debit) !== sum(credit). Caller's
 * outer transaction (or fire-and-forget) handles the error. Keep journal
 * mapping pure & well-tested so this never trips in production.
 *
 * Entry number `JE-YYYYMM-NNNN`: atomic per (outletId, periodId) via Postgres
 * advisory lock. Pattern mirrors transaction_number generator.
 *
 * Period auto-creation: derives Jakarta calendar year-month from `entryDate`,
 * creates the period row if missing (status='open'). If the period is
 * 'locked', throws "PERIOD_LOCKED" — caller must reopen first.
 */

export type JournalLineInput = {
  /** Either accountId direct OR accountCode resolved at post time. One required. */
  accountId?: string;
  accountCode?: string;
  debit?: number;
  credit?: number;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type RecordJournalInput = {
  outletId: string;
  /** Date of economic event (YYYY-MM-DD). Determines period. */
  entryDate: string;
  description: string;
  sourceType: JournalSourceType;
  sourceId?: string | null;
  lines: JournalLineInput[];
  status?: "draft" | "posted";
  metadata?: Record<string, unknown> | null;
  /** Acting user id (Owner for manual; system actor for auto). */
  actorId: string;
};

export type RecordJournalResult = {
  entryId: string;
  entryNumber: string;
  periodId: string;
  /** True kalau row baru insert; false kalau idempotency hit (existing entry). */
  created: boolean;
};

const ZERO = 0;

function jakartaYearMonthFromIso(iso: string): { year: number; month: number } {
  const [yy, mm] = iso.split("-");
  return { year: Number(yy), month: Number(mm) };
}

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Sesi AE-185 — format nomor jurnal, dipakai bersama oleh `recordJournal`
 * (saat entry dibuat) dan `updateJournalEntryDate` (saat entry pindah bulan
 * sehingga nomornya harus diterbitkan ulang). Dijadikan satu fungsi supaya
 * kedua jalur tidak bisa menghasilkan format yang berbeda.
 */
export function formatJournalEntryNumber(
  year: number,
  month: number,
  seq: number,
): string {
  return `JE-${year}${pad2(month)}-${pad4(seq)}`;
}

/** Kunci antrean nomor per (outlet, periode) — dipakai advisory lock. */
export function journalSeqLockKey(
  outletId: string,
  year: number,
  month: number,
): string {
  return `je-seq-${outletId}-${year}-${pad2(month)}`;
}

/** Apakah dua tanggal ISO berada di bulan kalender yang berbeda? */
export function isDifferentPeriod(aIso: string, bIso: string): boolean {
  return aIso.slice(0, 7) !== bIso.slice(0, 7);
}

/**
 * Resolve account refs in lines. Each line must have accountId OR accountCode.
 * Returns lines with accountId populated. Throws "ACCOUNT_NOT_FOUND" or
 * "ACCOUNT_INACTIVE" on resolve failure.
 *
 * Sesi AE-63 phase4 — exported supaya updateDraftJournalEntry bisa reuse
 * validation logic yang sama dengan recordJournal (DRY).
 */
export async function resolveAccounts(
  outletId: string,
  lines: JournalLineInput[],
): Promise<{ accountId: string; debit: number; credit: number; description: string | null; metadata: Record<string, unknown> | null }[]> {
  const codesNeeded = new Set<string>();
  for (const l of lines) {
    if (!l.accountId && l.accountCode) codesNeeded.add(l.accountCode);
  }

  const codeToId = new Map<string, string>();
  if (codesNeeded.size > 0) {
    const rows = await db
      .select({
        id: chartOfAccounts.id,
        code: chartOfAccounts.code,
        isActive: chartOfAccounts.isActive,
        deletedAt: chartOfAccounts.deletedAt,
      })
      .from(chartOfAccounts)
      .where(eq(chartOfAccounts.outletId, outletId));
    for (const r of rows) {
      if (!codesNeeded.has(r.code)) continue;
      if (r.deletedAt !== null) continue;
      if (!r.isActive) {
        throw new Error(`ACCOUNT_INACTIVE:${r.code}`);
      }
      codeToId.set(r.code, r.id);
    }
    for (const code of codesNeeded) {
      if (!codeToId.has(code)) {
        throw new Error(`ACCOUNT_NOT_FOUND:${code}`);
      }
    }
  }

  return lines.map((l) => {
    const id = l.accountId ?? (l.accountCode ? codeToId.get(l.accountCode)! : null);
    if (!id) throw new Error("LINE_MISSING_ACCOUNT");
    return {
      accountId: id,
      debit: l.debit ?? ZERO,
      credit: l.credit ?? ZERO,
      description: l.description ?? null,
      metadata: l.metadata ?? null,
    };
  });
}

/**
 * Validate XOR + non-negative + balance. Returns sums for caller logging.
 *
 * Sesi AE-63 phase4 — exported (sama alasan dengan resolveAccounts).
 */
export function validateLines(
  resolved: { debit: number; credit: number }[],
): { totalDebit: number; totalCredit: number } {
  if (resolved.length < 2) {
    throw new Error("JOURNAL_TOO_FEW_LINES");
  }
  let totalDebit = 0;
  let totalCredit = 0;
  for (const l of resolved) {
    if (l.debit < 0 || l.credit < 0) {
      throw new Error("JOURNAL_NEGATIVE_AMOUNT");
    }
    if ((l.debit > 0 && l.credit > 0) || (l.debit === 0 && l.credit === 0)) {
      throw new Error("JOURNAL_LINE_XOR");
    }
    totalDebit += l.debit;
    totalCredit += l.credit;
  }
  if (totalDebit !== totalCredit) {
    throw new Error(
      `JOURNAL_IMBALANCED:debit=${totalDebit},credit=${totalCredit}`,
    );
  }
  return { totalDebit, totalCredit };
}

/**
 * Idempotency check — returns existing entry if (outletId, sourceType, sourceId)
 * already has an active entry. Skips reversed entries.
 *
 * Sesi AE-76 — `txOrDb` arg supaya bisa di-reuse inside transaction (AFTER
 * advisory lock) untuk race-condition safety. Tanpa ini, 2 concurrent fires
 * untuk same source bisa both see null pre-tx → both insert → second hits
 * UNIQUE violation `ux_je_outlet_source_active`.
 */
async function findExistingEntry(
  outletId: string,
  sourceType: JournalSourceType,
  sourceId: string | null,
  txOrDb: typeof db = db,
): Promise<{ id: string; entryNumber: string; periodId: string } | null> {
  if (!sourceId) return null;
  const [row] = await txOrDb
    .select({
      id: journalEntries.id,
      entryNumber: journalEntries.entryNumber,
      periodId: journalEntries.periodId,
    })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.outletId, outletId),
        eq(journalEntries.sourceType, sourceType),
        eq(journalEntries.sourceId, sourceId),
        sql`${journalEntries.status} <> 'reversed'`,
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function recordJournal(
  input: RecordJournalInput,
): Promise<RecordJournalResult> {
  // Idempotency: short-circuit before any work.
  const existing = await findExistingEntry(
    input.outletId,
    input.sourceType,
    input.sourceId ?? null,
  );
  if (existing) {
    return {
      entryId: existing.id,
      entryNumber: existing.entryNumber,
      periodId: existing.periodId,
      created: false,
    };
  }

  // Resolve accounts + validate balance BEFORE touching DB.
  const resolved = await resolveAccounts(input.outletId, input.lines);
  validateLines(resolved);

  // Period derivation
  const { year, month } = jakartaYearMonthFromIso(input.entryDate);

  return db.transaction(async (tx) => {
    // Resolve or create period
    let [periodRow] = await tx
      .select({
        id: accountingPeriods.id,
        status: accountingPeriods.status,
      })
      .from(accountingPeriods)
      .where(
        and(
          eq(accountingPeriods.outletId, input.outletId),
          eq(accountingPeriods.periodYear, year),
          eq(accountingPeriods.periodMonth, month),
        ),
      )
      .limit(1);

    if (!periodRow) {
      [periodRow] = await tx
        .insert(accountingPeriods)
        .values({
          outletId: input.outletId,
          periodYear: year,
          periodMonth: month,
          status: "open",
        })
        .returning({
          id: accountingPeriods.id,
          status: accountingPeriods.status,
        });
    }

    if (periodRow.status === "locked") {
      throw new Error(`PERIOD_LOCKED:${year}-${pad2(month)}`);
    }

    // Advisory lock for serial entry number gen per (outlet, period).
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${journalSeqLockKey(input.outletId, year, month)}))`,
    );

    /* Sesi AE-76 — RACE FIX: re-check existence AFTER lock acquired. Tanpa
     * ini, 2 concurrent fires untuk same (outlet, sourceType, sourceId):
     *   1. Both call findExistingEntry pre-tx → both see null.
     *   2. Both enter tx + acquire lock (sequential per lock semantics).
     *   3. First insert succeeds (entry_number JE-...N, source UNIQUE OK).
     *   4. Second insert fails dengan SQLSTATE 23505 ON
     *      `ux_je_outlet_source_active` constraint — RAISES error → audit
     *      log "Failed query: insert into journal_entries..." → queue retry
     *      → retry sees existing now (post-fix) → returns ok idempotent.
     * Fix: re-check inside tx setelah lock → second caller sees existing
     * dan return early tanpa attempt insert. Idempotency guaranteed. */
    if (input.sourceId) {
      const existingInTx = await findExistingEntry(
        input.outletId,
        input.sourceType,
        input.sourceId,
        tx as unknown as typeof db,
      );
      if (existingInTx) {
        return {
          entryId: existingInTx.id,
          entryNumber: existingInTx.entryNumber,
          periodId: existingInTx.periodId,
          created: false,
        };
      }
    }

    /* Sesi AE-76 — sequence generation via MAX(seq)+1, BUKAN COUNT(*)+1.
     *
     * Bug history: COUNT(*)+1 broken kalau ada entries yang di-delete
     * (deleteDraftJournalEntry hard-delete row). Setelah delete, count
     * turun tapi MAX entry_number tetap → next insert pakai seq dari
     * count+1 yang sudah taken oleh existing entry → UNIQUE violation
     * SQLSTATE 23505 di `ux_je_outlet_number`.
     *
     * MAX+1 gap-tolerant: meski ada deleted slot di tengah, seq baru
     * selalu > existing max → guaranteed fresh. Advisory lock di atas
     * tetap dipakai untuk serialize concurrent insert dalam satu period.
     *
     * Regex: extract trailing digit grup setelah dash terakhir di
     * entry_number format "JE-YYYYMM-NNNN". COALESCE(..., 0) handle
     * period kosong (no entries yet → seq=1). */
    const [{ maxSeq }] = await tx
      .select({
        maxSeq: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${journalEntries.entryNumber} FROM '-([0-9]+)$') AS INT)), 0)::int`,
      })
      .from(journalEntries)
      .where(eq(journalEntries.periodId, periodRow.id));

    const seq = maxSeq + 1;
    const entryNumber = formatJournalEntryNumber(year, month, seq);

    // Insert header
    const [insertedEntry] = await tx
      .insert(journalEntries)
      .values({
        outletId: input.outletId,
        periodId: periodRow.id,
        entryNumber,
        entryDate: input.entryDate,
        description: input.description,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        status: input.status ?? "posted",
        postedAt: input.status === "draft" ? null : new Date(),
        postedBy: input.status === "draft" ? null : input.actorId,
        createdBy: input.actorId,
        metadata: input.metadata ?? null,
      })
      .returning();

    // Insert lines
    const lineRows = resolved.map((l, idx) => ({
      entryId: insertedEntry.id,
      lineNumber: idx + 1,
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
      description: l.description,
      metadata: l.metadata,
    }));
    await tx.insert(journalLines).values(lineRows);

    return {
      entryId: insertedEntry.id,
      entryNumber,
      periodId: periodRow.id,
      created: true,
    };
  });
}
