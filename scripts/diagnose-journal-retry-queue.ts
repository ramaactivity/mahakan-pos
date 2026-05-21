/**
 * Sesi AE-76 — Diagnostic tool untuk journal retry queue pending entries.
 *
 * Owner story: 3 entries pending di Antrian Jurnal, retry gagal terus dengan
 * "Failed query: insert into journal_entries..." tanpa reason. Sebelum
 * AE-76 deploy, audit log cuma capture e.message (SQL only), reason di
 * e.cause ter-drop. Script ini cek state DB langsung untuk diagnose:
 *
 *   - Apakah journal_entry sudah ada untuk (outlet, sourceType, sourceId)?
 *     → kalau ada dengan status='posted'/'draft', queue should auto-resolve
 *     → kalau ada dengan status='reversed' saja, queue boleh retry.
 *   - Apakah accounting_period locked? → PERIOD_LOCKED bukan retry-able.
 *   - Apakah source entity (transaction / expense / income / opname) masih ada?
 *
 * Usage:
 *   npx tsx scripts/diagnose-journal-retry-queue.ts [outletId]
 *
 * Tidak modify data — read-only.
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  accountingPeriods,
  expenses,
  incomes,
  journalEntries,
  journalRetryQueue,
  stockOpnameSessions,
  transactions,
} from "../src/db/schema";

const outletIdArg = process.argv[2];

async function main() {
  const conds = [
    isNull(journalRetryQueue.resolvedAt),
    isNull(journalRetryQueue.abandonedAt),
  ];
  if (outletIdArg) {
    conds.push(eq(journalRetryQueue.outletId, outletIdArg));
  }

  const rows = await db
    .select()
    .from(journalRetryQueue)
    .where(and(...conds))
    .orderBy(desc(journalRetryQueue.createdAt));

  if (rows.length === 0) {
    console.log("✅ Tidak ada pending entries di journal_retry_queue.");
    return;
  }

  console.log(`Found ${rows.length} pending row(s).\n`);

  for (const r of rows) {
    console.log("=".repeat(72));
    console.log(`Queue ID:    ${r.id}`);
    console.log(`Created:     ${r.createdAt.toISOString()}`);
    console.log(`Hook label:  ${r.hookLabel}`);
    console.log(`Source:      ${r.sourceType} / ${r.sourceId}`);
    console.log(`Outlet:      ${r.outletId}`);
    console.log(`Retry count: ${r.retryCount}`);
    console.log(`Last error:  ${(r.lastError ?? "").slice(0, 200)}`);

    // Check existing journal entries for this source.
    if (r.sourceId && r.sourceType) {
      const entries = await db
        .select({
          id: journalEntries.id,
          entryNumber: journalEntries.entryNumber,
          status: journalEntries.status,
          periodId: journalEntries.periodId,
          entryDate: journalEntries.entryDate,
          postedAt: journalEntries.postedAt,
          reversedByEntryId: journalEntries.reversedByEntryId,
        })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.outletId, r.outletId),
            sql`${journalEntries.sourceType} = ${r.sourceType}`,
            eq(journalEntries.sourceId, r.sourceId),
          ),
        );

      if (entries.length === 0) {
        console.log("Journal entries:  NONE — insert path should succeed.");
      } else {
        console.log(`Journal entries: ${entries.length} found:`);
        for (const e of entries) {
          console.log(
            `  - ${e.entryNumber} status=${e.status} date=${e.entryDate}` +
              (e.reversedByEntryId ? ` (reversed by ${e.reversedByEntryId})` : ""),
          );
        }
        const active = entries.filter(
          (e) => e.status === "posted" || e.status === "draft",
        );
        if (active.length > 0) {
          console.log(
            "  ⚠ ACTIVE entry exists — queue row should auto-resolve on next retry (after AE-76 deploy).",
          );
        }
      }

      // Check accounting period status if it can be derived.
      if (entries[0]?.periodId) {
        const [period] = await db
          .select({
            id: accountingPeriods.id,
            status: accountingPeriods.status,
            periodYear: accountingPeriods.periodYear,
            periodMonth: accountingPeriods.periodMonth,
          })
          .from(accountingPeriods)
          .where(eq(accountingPeriods.id, entries[0].periodId))
          .limit(1);
        if (period) {
          console.log(
            `Period:      ${period.periodYear}-${String(period.periodMonth).padStart(2, "0")} status=${period.status}`,
          );
        }
      }

      // Check source entity exists.
      let sourceExists: boolean = true;
      if (r.sourceType === "pos_sale" || r.sourceType === "pos_sale_open_bill_close") {
        const [trx] = await db
          .select({ id: transactions.id, status: transactions.status, num: transactions.transactionNumber })
          .from(transactions)
          .where(eq(transactions.id, r.sourceId))
          .limit(1);
        sourceExists = !!trx;
        if (trx) {
          console.log(`Transaction: ${trx.num} status=${trx.status}`);
        }
      } else if (r.sourceType === "expense_create") {
        const [exp] = await db
          .select({ id: expenses.id })
          .from(expenses)
          .where(eq(expenses.id, r.sourceId))
          .limit(1);
        sourceExists = !!exp;
      } else if (r.sourceType === "income_create") {
        const [inc] = await db
          .select({ id: incomes.id })
          .from(incomes)
          .where(eq(incomes.id, r.sourceId))
          .limit(1);
        sourceExists = !!inc;
      } else if (r.sourceType === "opname_adjustment") {
        const [op] = await db
          .select({ id: stockOpnameSessions.id })
          .from(stockOpnameSessions)
          .where(eq(stockOpnameSessions.id, r.sourceId))
          .limit(1);
        sourceExists = !!op;
      }
      if (!sourceExists) {
        console.log("  🚨 Source entity MISSING — queue should be abandoned (orphan).");
      }
    }

    console.log("");
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("[diagnose-journal-retry-queue]", e);
  process.exit(1);
});
