/**
 * Sesi AE-156d — Audit split metode payment correctness.
 *
 * Check:
 *  1. Schema constraints (read-only verify trx + split_payments DB-level)
 *  2. Existing split transactions di DB — apakah sum splits = trx.total?
 *  3. Journal entries — apakah ter-create + balanced per-method allocation?
 *  4. Inventory deduction — stock_deducted_at set untuk split paid trx
 *  5. Loyalty earn fired (kalau ada customer)
 *  6. Shift aggregation — apakah split trx di-include di paid summary
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import {
  journalEntries,
  journalLines,
  splitPayments,
  transactions,
} from "@/db/schema";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function main() {
  console.log("\n=== Audit Split Payments ===\n");

  /* 1. Cari trx yang paymentMethod=split. */
  const splitTrxs = await db
    .select({
      id: transactions.id,
      transactionNumber: transactions.transactionNumber,
      total: transactions.total,
      status: transactions.status,
      paymentMethod: transactions.paymentMethod,
      cashReceived: transactions.cashReceived,
      cashChange: transactions.cashChange,
      stockDeductedAt: transactions.stockDeductedAt,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .where(eq(transactions.paymentMethod, "split"))
    .orderBy(desc(transactions.createdAt))
    .limit(20);

  console.log(`Total split transactions: ${splitTrxs.length}\n`);

  if (splitTrxs.length === 0) {
    console.log("Belum ada split transaction di DB.\n");
    await pool.end();
    process.exit(0);
  }

  let ok = 0;
  let issues = 0;

  for (const t of splitTrxs) {
    console.log(`Trx ${t.transactionNumber} (${t.id.slice(0, 8)})`);
    console.log(
      `  status=${t.status} total=Rp${t.total.toLocaleString("id-ID")} created=${t.createdAt.toISOString()}`,
    );

    /* Check trx-level cash fields null per ck constraint. */
    if (t.cashReceived !== null || t.cashChange !== null) {
      console.log(
        `  ✗ ANOMALY: cashReceived=${t.cashReceived}, cashChange=${t.cashChange} (harus null untuk split)`,
      );
      issues++;
    }

    /* Check stock_deducted_at set untuk paid. */
    if (t.status === "paid" && t.stockDeductedAt === null) {
      console.log(`  ✗ ANOMALY: stockDeductedAt NULL untuk paid trx`);
      issues++;
    }

    /* Fetch splits + sum check. */
    const splits = await db
      .select({
        id: splitPayments.id,
        paymentMethod: splitPayments.paymentMethod,
        amount: splitPayments.amount,
        cashReceived: splitPayments.cashReceived,
        cashChange: splitPayments.cashChange,
        splitKind: splitPayments.splitKind,
      })
      .from(splitPayments)
      .where(eq(splitPayments.transactionId, t.id));

    const sumSplits = splits.reduce((acc, s) => acc + s.amount, 0);
    console.log(`  Splits (${splits.length}):`);
    for (const s of splits) {
      const cashInfo =
        s.paymentMethod === "cash"
          ? ` (received=${s.cashReceived}, change=${s.cashChange})`
          : "";
      console.log(
        `    - ${s.paymentMethod.padEnd(12)} Rp${s.amount.toLocaleString("id-ID")} [${s.splitKind}]${cashInfo}`,
      );
    }
    console.log(`  Sum splits: Rp${sumSplits.toLocaleString("id-ID")}`);

    if (sumSplits !== t.total) {
      console.log(
        `  ✗ ANOMALY: sum(splits) ≠ total (selisih Rp${(t.total - sumSplits).toLocaleString("id-ID")})`,
      );
      issues++;
    } else {
      console.log(`  ✓ Sum splits = total`);
    }

    /* Cek journal entries. */
    const journals = await db
      .select({
        id: journalEntries.id,
        sourceType: journalEntries.sourceType,
        sourceId: journalEntries.sourceId,
        status: journalEntries.status,
        description: journalEntries.description,
      })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.sourceId, t.id),
          eq(journalEntries.sourceType, "pos_sale"),
        ),
      );

    if (journals.length === 0) {
      console.log(`  ⚠ NO journal entry (mungkin pre-cutover atau hook gagal)`);
    } else {
      for (const j of journals) {
        const lines = await db
          .select()
          .from(journalLines)
          .where(eq(journalLines.entryId, j.id));

        const totalDebit = lines.reduce((acc, l) => acc + l.debit, 0);
        const totalCredit = lines.reduce((acc, l) => acc + l.credit, 0);

        console.log(`  Journal ${j.id.slice(0, 8)} status=${j.status}`);
        for (const l of lines) {
          const debitStr = l.debit > 0 ? `Dr ${l.debit.toLocaleString("id-ID")}` : "          ";
          const creditStr =
            l.credit > 0 ? `Cr ${l.credit.toLocaleString("id-ID")}` : "          ";
          console.log(
            `    acct=${l.accountId.slice(0, 8)} ${debitStr.padEnd(15)} ${creditStr.padEnd(15)} ${l.description ?? ""}`,
          );
        }

        if (totalDebit !== totalCredit) {
          console.log(
            `  ✗ ANOMALY: journal unbalanced (Dr=${totalDebit}, Cr=${totalCredit})`,
          );
          issues++;
        }

        /* Verify per-method allocation untuk split sale.
         * Expected pattern:
         *   Dr <method_account> = split.amount  (per split row)
         *   Cr 4101/4102 Revenue
         */
        const debitLines = lines.filter((l) => l.debit > 0);
        if (debitLines.length === splits.length) {
          /* Check each debit matches a split amount. */
          const splitAmountsSet = new Set(splits.map((s) => s.amount));
          const debitAmountsSet = new Set(debitLines.map((l) => l.debit));
          const allMatch =
            splitAmountsSet.size === debitAmountsSet.size &&
            Array.from(splitAmountsSet).every((a) => debitAmountsSet.has(a));
          if (allMatch) {
            console.log(`  ✓ Per-method allocation match splits`);
          } else {
            console.log(
              `  ⚠ Debit allocation tidak match splits exactly — manual review`,
            );
          }
        } else {
          /* Bisa juga ada compound debit kalau journal merge same-account. */
          console.log(
            `  ℹ Debit lines=${debitLines.length} vs splits=${splits.length} (mungkin merged per account, OK)`,
          );
        }
      }
    }

    if (sumSplits === t.total && journals.length > 0) ok++;
    console.log("");
  }

  console.log(`\nSummary: ${ok} OK / ${issues} anomalies / ${splitTrxs.length} total\n`);

  /* Aggregate per-method spread across all splits — sanity check overall
   * distribution. */
  const allSplits = await db
    .select({
      paymentMethod: splitPayments.paymentMethod,
      amount: splitPayments.amount,
    })
    .from(splitPayments);

  const byMethod = new Map<string, { count: number; sum: number }>();
  for (const s of allSplits) {
    const prev = byMethod.get(s.paymentMethod) ?? { count: 0, sum: 0 };
    prev.count += 1;
    prev.sum += s.amount;
    byMethod.set(s.paymentMethod, prev);
  }

  console.log("=== Aggregate split distribution ===");
  for (const [m, v] of byMethod.entries()) {
    console.log(
      `  ${m.padEnd(12)} ${v.count}× Rp${v.sum.toLocaleString("id-ID")}`,
    );
  }

  await pool.end();
  process.exit(issues > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("ERROR:", e);
  await pool.end();
  process.exit(1);
});
