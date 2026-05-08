/**
 * `npx tsx scripts/wipe-test-data.ts` — destructive wipe of all POS test data.
 *
 * USE CASE: smoke-test cleanup before production launch. Removes every
 * transaction, bill, payment, refund, journal entry, and audit log tied to
 * test operations so kasir can start fresh.
 *
 * WHAT GETS DELETED (in dependency order):
 *   1. transaction_item_modifiers
 *   2. transaction_items
 *   3. split_payments (if any)
 *   4. promo_usages
 *   5. expenses where source_type='refund' (refund-linked test data)
 *   6. journal_lines + journal_entries where sourceType pos_sale/refund/compliment
 *   7. audit_logs where entity_type='transaction'
 *   8. transactions
 *   9. shift counters reset (cash_sales, qris_sales, etc → 0) for active shifts
 *
 * WHAT IS PRESERVED:
 *   - Menu items, categories, modifiers (master data)
 *   - Users, employees, payroll records
 *   - Shift records (just zeroed out — not deleted)
 *   - Outlet, settings, COA, fixed assets
 *   - Inventory ingredients (master) — but stock movements are zeroed via
 *     subsequent `npx tsx scripts/seed-mock-stock.ts` or manual entry
 *   - Purchase records (separate from POS transactions)
 *
 * USAGE:
 *   npx tsx scripts/wipe-test-data.ts            → dry-run, prints counts
 *   npx tsx scripts/wipe-test-data.ts --confirm  → actually deletes
 *
 * SAFETY: requires --confirm flag. Always shows count summary first.
 *
 * NOT FOR PRODUCTION DATA. Once real revenue starts, NEVER run this.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL not set in .env.local");
  process.exit(1);
}

const confirmed = process.argv.includes("--confirm");

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle({ client: pool });

  console.log("─".repeat(60));
  console.log(`Mode: ${confirmed ? "🔥 EXECUTE" : "🔍 DRY-RUN (use --confirm to actually delete)"}`);
  console.log("─".repeat(60));

  // Count current state
  const counts = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM transactions) AS transactions,
      (SELECT count(*) FROM transaction_items) AS items,
      (SELECT count(*) FROM transaction_item_modifiers) AS modifiers,
      (SELECT count(*) FROM refund_event_items) AS refund_event_items,
      (SELECT count(*) FROM refund_events) AS refund_events,
      (SELECT count(*) FROM split_payment_items) AS split_payment_items,
      (SELECT count(*) FROM split_payments) AS splits,
      (SELECT count(*) FROM approval_codes WHERE target_transaction_id IS NOT NULL) AS approval_codes,
      (SELECT count(*) FROM promo_usages) AS promo_usages,
      (SELECT count(*) FROM expenses WHERE source_type = 'refund') AS refund_expenses,
      (SELECT count(*) FROM journal_entries WHERE source_type IN ('pos_sale','pos_refund','pos_compliment')) AS journal_entries,
      (SELECT count(*) FROM audit_logs WHERE entity_type = 'transaction') AS audit_logs,
      (SELECT count(*) FROM shifts WHERE status = 'open') AS open_shifts
  `);
  const c = counts.rows[0] as Record<string, unknown>;
  console.log("Current data counts:");
  console.log(`  transactions:              ${c.transactions}`);
  console.log(`  transaction_items:         ${c.items}`);
  console.log(`  transaction_item_modifiers:${c.modifiers}`);
  console.log(`  refund_event_items:        ${c.refund_event_items}`);
  console.log(`  refund_events:             ${c.refund_events}`);
  console.log(`  split_payment_items:       ${c.split_payment_items}`);
  console.log(`  split_payments:            ${c.splits}`);
  console.log(`  approval_codes (trx):      ${c.approval_codes}`);
  console.log(`  promo_usages:              ${c.promo_usages}`);
  console.log(`  refund expenses:           ${c.refund_expenses}`);
  console.log(`  POS journal entries:       ${c.journal_entries}`);
  console.log(`  transaction audit logs:    ${c.audit_logs}`);
  console.log(`  active shifts to reset:    ${c.open_shifts}`);
  console.log("─".repeat(60));

  if (!confirmed) {
    console.log("");
    console.log("ℹ️  DRY-RUN — no changes made.");
    console.log("   Run with --confirm flag to actually delete.");
    console.log("");
    await pool.end();
    return;
  }

  // ────────────────────────────────────────────────────────────────
  // EXECUTE DELETE in dependency order, all in one transaction
  // ────────────────────────────────────────────────────────────────
  console.log("");
  console.log("🔥 Executing wipe...");

  await db.transaction(async (tx) => {
    // 1. Modifiers (FK to transaction_items)
    await tx.execute(sql`DELETE FROM transaction_item_modifiers`);
    console.log("  ✓ transaction_item_modifiers cleared");

    // 2. Refund event items (FK to transaction_items + refund_events)
    //    MUST be deleted BEFORE transaction_items (FK constraint).
    await tx.execute(sql`DELETE FROM refund_event_items`);
    console.log("  ✓ refund_event_items cleared");

    // 3. Refund events (FK to transactions)
    await tx.execute(sql`DELETE FROM refund_events`);
    console.log("  ✓ refund_events cleared");

    // 4. Split payment items (FK to transaction_items + split_payments)
    await tx.execute(sql`DELETE FROM split_payment_items`);
    console.log("  ✓ split_payment_items cleared");

    // 5. Split payments (FK to transactions)
    await tx.execute(sql`DELETE FROM split_payments`);
    console.log("  ✓ split_payments cleared");

    // 6. Approval codes consumed by transactions (FK to transactions)
    //    Only delete trx-linked codes; keep unconsumed ones for active
    //    approver flow.
    await tx.execute(
      sql`DELETE FROM approval_codes WHERE target_transaction_id IS NOT NULL`,
    );
    console.log("  ✓ approval_codes (trx-linked) cleared");

    // 7. Items (FK to transactions) — now safe after refund_event_items
    //    + split_payment_items cleared
    await tx.execute(sql`DELETE FROM transaction_items`);
    console.log("  ✓ transaction_items cleared");

    // 8. Promo usages (FK to transactions)
    await tx.execute(sql`DELETE FROM promo_usages`);
    console.log("  ✓ promo_usages cleared");

    // 9. Refund expenses (linked via refunded_transaction_id)
    await tx.execute(sql`
      DELETE FROM expenses
      WHERE source_type = 'refund'
         OR refunded_transaction_id IS NOT NULL
    `);
    console.log("  ✓ refund expenses cleared");

    // 10a. Journal lines for POS journal entries
    await tx.execute(sql`
      DELETE FROM journal_lines
      WHERE journal_entry_id IN (
        SELECT id FROM journal_entries
        WHERE source_type IN ('pos_sale','pos_refund','pos_compliment','shift_variance')
      )
    `);
    console.log("  ✓ POS journal_lines cleared");

    // 10b. Journal entries POS-linked
    await tx.execute(sql`
      DELETE FROM journal_entries
      WHERE source_type IN ('pos_sale','pos_refund','pos_compliment','shift_variance')
    `);
    console.log("  ✓ POS journal_entries cleared");

    // 11. Audit logs for transactions
    await tx.execute(sql`
      DELETE FROM audit_logs WHERE entity_type = 'transaction'
    `);
    console.log("  ✓ transaction audit_logs cleared");

    // 12. Transactions themselves
    await tx.execute(sql`DELETE FROM transactions`);
    console.log("  ✓ transactions cleared");

    // 9. Reset settlement counters for any open shifts (sales aggregates
    //    are computed from transactions table on the fly, so deleting
    //    transactions already zeroes those views. The settlement fields
    //    below are kasir-entered values from prior close attempts that
    //    should also reset to NULL so kasir starts fresh).
    const shiftReset = await tx.execute(sql`
      UPDATE shifts
      SET edc_settlement = NULL,
          gofood_settlement = NULL,
          grabfood_settlement = NULL,
          shopeefood_settlement = NULL,
          actual_cash = NULL,
          variance = NULL
      WHERE status = 'open'
    `);
    console.log(`  ✓ ${shiftReset.rowCount ?? 0} open shifts reset (settlements + actual cash cleared)`);
  });

  console.log("");
  console.log("✅ Wipe complete. POS is fresh slate.");
  console.log("");
  console.log("Next steps:");
  console.log("  - Optionally run: npx tsx scripts/seed-mock-stock.ts (if test stock needed)");
  console.log("  - Tutup shift yang aktif via UI (counter sudah ke-reset)");
  console.log("  - Buka shift baru → start clean transactions");
  console.log("");

  await pool.end();
}

main().catch((err) => {
  console.error("❌ Wipe failed:", err);
  process.exit(1);
});
