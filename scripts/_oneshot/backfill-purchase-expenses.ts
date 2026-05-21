/**
 * Sesi AE-79 — One-shot backfill untuk expense rows yang pre-AE-79
 * dibuat oleh purchase flow tanpa sourceType='purchase' + purchaseId.
 *
 * Heuristic: expense yang sourceType='manual' DAN ada purchase yang
 * tertaut via purchases.expense_id → backfill expense.sourceType='purchase'
 * dan expense.purchase_id sesuai.
 *
 * Read+write. Dry-run pertama (set EXEC=1 environment var untuk apply).
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, isNull, sql } from "drizzle-orm";
import { expenses, purchases } from "@/db/schema";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);
const dryRun = process.env.EXEC !== "1";

async function main() {
  // Find expense rows yang harus di-backfill
  const targets = await db
    .select({
      purchaseId: purchases.id,
      expenseId: purchases.expenseId,
      expSourceType: expenses.sourceType,
      expPurchaseId: expenses.purchaseId,
    })
    .from(purchases)
    .innerJoin(expenses, eq(expenses.id, purchases.expenseId))
    .where(
      and(
        sql`${purchases.expenseId} IS NOT NULL`,
        eq(expenses.sourceType, "manual"),
        isNull(expenses.purchaseId),
      ),
    );

  console.log(`Found ${targets.length} expense row to backfill.`);
  console.log(dryRun ? "[DRY RUN — set EXEC=1 to apply]" : "[APPLY MODE]");

  for (const t of targets) {
    console.log(
      `  - expense=${t.expenseId} → sourceType='purchase', purchase_id=${t.purchaseId}`,
    );
    if (!dryRun && t.expenseId) {
      await db
        .update(expenses)
        .set({
          sourceType: "purchase",
          purchaseId: t.purchaseId,
        })
        .where(eq(expenses.id, t.expenseId));
    }
  }

  if (dryRun) {
    console.log("\nDry run complete. Re-run with EXEC=1 to apply.");
  } else {
    console.log(`\n✓ Backfilled ${targets.length} rows.`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
