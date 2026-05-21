/**
 * Sesi AE-79 — Audit script untuk memverifikasi purchase flow integrity:
 *   1. Negative stock items (Ayam Fillet -2972 gr, dll) — root cause analysis
 *   2. Expense rows yang seharusnya sourceType='purchase' tapi masih 'manual'
 *      (existed sebelum AE-79 fix → perlu backfill)
 *   3. Journal entries duplicate per source (sanity check)
 *   4. Orphaned expenses (purchase_id null tapi description "Pembelanjaan ...")
 *
 * Read-only. Tidak modify data. Output ke stdout.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, desc, eq, isNull, like, lt, or, sql } from "drizzle-orm";
import {
  expenses,
  ingredients,
  inventoryMovements,
  journalEntries,
  purchases,
} from "@/db/schema";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function checkNegativeStock() {
  console.log("=".repeat(72));
  console.log("1. NEGATIVE STOCK AUDIT");
  console.log("=".repeat(72));

  const negativeRows = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      unit: ingredients.unit,
      currentStock: ingredients.currentStock,
      currentStockDecimal: ingredients.currentStockDecimal,
      isActive: ingredients.isActive,
    })
    .from(ingredients)
    .where(lt(ingredients.currentStock, 0))
    .orderBy(ingredients.currentStock);

  console.log(`\n${negativeRows.length} bahan dengan stok negatif:`);
  for (const r of negativeRows) {
    console.log(
      `  - ${r.name} (${r.unit}) = ${r.currentStock} | decimal=${r.currentStockDecimal} | active=${r.isActive}`,
    );
  }

  // For top 5 negative, dump last 10 movements
  for (const r of negativeRows.slice(0, 5)) {
    console.log(`\n  --- Last 10 movements for ${r.name} ---`);
    const moves = await db
      .select({
        kind: inventoryMovements.kind,
        qtyDelta: inventoryMovements.qtyDelta,
        qtyDeltaDecimal: inventoryMovements.qtyDeltaDecimal,
        reason: inventoryMovements.reason,
        createdAt: inventoryMovements.createdAt,
      })
      .from(inventoryMovements)
      .where(eq(inventoryMovements.ingredientId, r.id))
      .orderBy(desc(inventoryMovements.createdAt))
      .limit(10);
    for (const m of moves) {
      console.log(
        `    ${m.createdAt.toISOString()} | ${m.kind} | ${m.qtyDelta} (${m.qtyDeltaDecimal ?? "—"}) | ${m.reason ?? ""}`,
      );
    }
  }
}

async function checkOrphanedExpensesFromPurchase() {
  console.log("\n" + "=".repeat(72));
  console.log(
    "2. EXPENSE sourceType BACKFILL (pre-AE-79: 'manual' tagged purchases)",
  );
  console.log("=".repeat(72));

  /* Heuristic: expense yang punya:
   *   - sourceType='manual' (default)
   *   - description start "Pembelanjaan " atau "Lunas TOP"
   *   - tertaut ke purchases via purchase.expenseId
   * Likely is purchase-created expense yang tidak di-tag dengan benar. */
  const candidates = await db
    .select({
      id: expenses.id,
      desc: expenses.description,
      sourceType: expenses.sourceType,
      purchaseId: expenses.purchaseId,
      createdAt: expenses.createdAt,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.sourceType, "manual"),
        or(
          like(expenses.description, "Pembelanjaan %"),
          like(expenses.description, "Lunas TOP %"),
        ),
      ),
    )
    .orderBy(desc(expenses.createdAt))
    .limit(50);

  console.log(
    `\n${candidates.length} expense rows yang seharusnya sourceType='purchase' (limit 50):`,
  );
  for (const c of candidates) {
    console.log(
      `  - ${c.createdAt.toISOString()} | "${(c.desc ?? "").slice(0, 60)}" | sourceType=${c.sourceType} | purchaseId=${c.purchaseId ?? "NULL"}`,
    );
  }

  // Reverse check: purchases.expenseId set tapi expenses.purchaseId null
  const orphans = await db
    .select({
      purchaseId: purchases.id,
      expenseId: purchases.expenseId,
      expDesc: expenses.description,
      expSourceType: expenses.sourceType,
      expPurchaseId: expenses.purchaseId,
    })
    .from(purchases)
    .innerJoin(expenses, eq(expenses.id, purchases.expenseId))
    .where(
      and(
        sql`${purchases.expenseId} IS NOT NULL`,
        isNull(expenses.purchaseId),
      ),
    )
    .limit(20);

  console.log(
    `\n${orphans.length} purchases tertaut ke expense, tapi expense.purchaseId NULL (FK asimetris):`,
  );
  for (const o of orphans) {
    console.log(
      `  - purchase=${o.purchaseId.slice(0, 8)} ↔ expense=${o.expenseId?.slice(0, 8)} | exp.sourceType=${o.expSourceType} | exp.purchaseId=${o.expPurchaseId ?? "NULL"}`,
    );
  }
}

async function checkDuplicateJournals() {
  console.log("\n" + "=".repeat(72));
  console.log("3. DUPLICATE JOURNAL ENTRIES PER SOURCE (sanity check)");
  console.log("=".repeat(72));

  const dupes = await db
    .select({
      sourceType: journalEntries.sourceType,
      sourceId: journalEntries.sourceId,
      count: sql<number>`count(*)::int`,
    })
    .from(journalEntries)
    .where(
      and(
        sql`${journalEntries.sourceId} IS NOT NULL`,
        sql`${journalEntries.status} = 'posted'`,
      ),
    )
    .groupBy(journalEntries.sourceType, journalEntries.sourceId)
    .having(sql`count(*) > 1`)
    .limit(20);

  if (dupes.length === 0) {
    console.log(
      "\n✓ Tidak ada duplicate posted journal entry per (sourceType, sourceId) — UNIQUE constraint working.",
    );
  } else {
    console.log(`\n⚠ ${dupes.length} duplicate found:`);
    for (const d of dupes) {
      console.log(
        `  - ${d.sourceType} / ${d.sourceId?.slice(0, 8)} × ${d.count}`,
      );
    }
  }
}

async function main() {
  await checkNegativeStock();
  await checkOrphanedExpensesFromPurchase();
  await checkDuplicateJournals();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
