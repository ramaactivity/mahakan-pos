/**
 * `npx tsx scripts/_oneshot/reset-inventory-clean.ts` — Clean reset inventory.
 *
 * Sesi AE-62d (2026-05-15) — owner request via gudang:
 *   "Tolong kosongkan semua stok bahan dan PR. Dia mau mengisi datanya
 *    dari 0 biar ga pusing liat stock nya."
 *
 * Owner pilih scope "Clean":
 *   - ingredients.currentStock = 0 + currentStockDecimal = "0.0000"
 *   - DELETE semua stock_opname_lines + stock_opname_sessions
 *   - DELETE semua inventory_movements
 *   - DELETE semua purchase_request_items + purchase_requests
 *   - UNLINK purchase_items.movement_id → NULL (preserve purchases history)
 *
 * PRESERVE:
 *   - Master bahan (ingredients table, cuma reset stock columns)
 *   - Supplier + Market List (supplier_ingredients) + pack info
 *   - Purchases + Purchase Items (histori transaksi pembelian)
 *   - Expenses, Journal Entries, Transactions, Shifts, Payroll, Attendance
 *
 * USAGE:
 *   npx tsx scripts/_oneshot/reset-inventory-clean.ts            → dry-run preview
 *   npx tsx scripts/_oneshot/reset-inventory-clean.ts --confirm  → execute
 *
 * SAFETY:
 *   - Requires --confirm flag
 *   - Wrapped in db.transaction → all-or-nothing
 *   - Logs row counts before + after for verification
 *   - Audit log inserted post-reset untuk track event
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL not set in .env.local");
  process.exit(1);
}

const confirmed = process.argv.includes("--confirm");

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();

  try {
    console.log("📊 Pre-reset counts:");
    const queries = [
      ["ingredients (stock > 0)", "SELECT COUNT(*) FROM ingredients WHERE current_stock > 0 OR current_stock_decimal::numeric > 0"],
      ["inventory_movements", "SELECT COUNT(*) FROM inventory_movements"],
      ["stock_opname_sessions", "SELECT COUNT(*) FROM stock_opname_sessions"],
      ["stock_opname_lines", "SELECT COUNT(*) FROM stock_opname_lines"],
      ["purchase_requests", "SELECT COUNT(*) FROM purchase_requests"],
      ["purchase_request_items", "SELECT COUNT(*) FROM purchase_request_items"],
      [
        "purchase_items (with movement_id)",
        "SELECT COUNT(*) FROM purchase_items WHERE movement_id IS NOT NULL",
      ],
      // Preserved tables (informational)
      ["purchases (PRESERVED)", "SELECT COUNT(*) FROM purchases"],
      ["ingredients TOTAL (PRESERVED, stock reset)", "SELECT COUNT(*) FROM ingredients"],
    ];
    for (const [label, sql] of queries) {
      const r = await client.query(sql);
      console.log(`  ${label}: ${r.rows[0].count}`);
    }

    if (!confirmed) {
      console.log("\n⚠️  DRY-RUN MODE. Tambahkan flag --confirm untuk execute.\n");
      console.log("Yang akan dihapus:");
      console.log("  - SEMUA inventory_movements");
      console.log("  - SEMUA stock_opname_sessions + lines");
      console.log("  - SEMUA purchase_requests + items");
      console.log("Yang akan diubah:");
      console.log("  - purchase_items.movement_id → NULL (preserve purchases)");
      console.log("  - ingredients.current_stock = 0, current_stock_decimal = '0.0000'");
      console.log("Yang DIPERTAHANKAN:");
      console.log("  - Master bahan, supplier, market list, purchases, expenses, journal, transactions, dll");
      return;
    }

    console.log("\n🚀 Executing transaction...\n");

    await client.query("BEGIN");

    try {
      // Step 1: Unlink purchase_items.movement_id (preserve purchases history)
      const r1 = await client.query(
        "UPDATE purchase_items SET movement_id = NULL WHERE movement_id IS NOT NULL",
      );
      console.log(`✓ Unlinked purchase_items.movement_id: ${r1.rowCount} rows`);

      // Step 2: Delete stock_opname_lines (FK to inventory_movements)
      const r2 = await client.query("DELETE FROM stock_opname_lines");
      console.log(`✓ Deleted stock_opname_lines: ${r2.rowCount} rows`);

      // Step 3: Delete stock_opname_sessions
      const r3 = await client.query("DELETE FROM stock_opname_sessions");
      console.log(`✓ Deleted stock_opname_sessions: ${r3.rowCount} rows`);

      // Step 4: Delete inventory_movements
      const r4 = await client.query("DELETE FROM inventory_movements");
      console.log(`✓ Deleted inventory_movements: ${r4.rowCount} rows`);

      // Step 5a: Unlink purchase_items.purchase_request_item_id (preserve purchases)
      const r5a = await client.query(
        "UPDATE purchase_items SET purchase_request_item_id = NULL WHERE purchase_request_item_id IS NOT NULL",
      );
      console.log(
        `✓ Unlinked purchase_items.purchase_request_item_id: ${r5a.rowCount} rows`,
      );

      // Step 5b: Delete purchase_request_items
      const r5 = await client.query("DELETE FROM purchase_request_items");
      console.log(`✓ Deleted purchase_request_items: ${r5.rowCount} rows`);

      // Step 6: Delete purchase_requests
      const r6 = await client.query("DELETE FROM purchase_requests");
      console.log(`✓ Deleted purchase_requests: ${r6.rowCount} rows`);

      // Step 7: Reset ingredients stock
      const r7 = await client.query(
        "UPDATE ingredients SET current_stock = 0, current_stock_decimal = '0.0000', updated_at = NOW()",
      );
      console.log(`✓ Reset ingredients stock: ${r7.rowCount} rows`);

      // Step 8: Audit log (use system reset event)
      const ownerRes = await client.query(
        "SELECT id, outlet_id FROM users WHERE role = 'owner' AND status = 'active' LIMIT 1",
      );
      const owner = ownerRes.rows[0];
      if (owner) {
        await client.query(
          `INSERT INTO audit_logs (event_type, user_id, entity_type, entity_id, payload, metadata, created_at)
           VALUES ($1, $2, NULL, NULL, $3, $4, NOW())`,
          [
            "system.reset_mockup_data",
            owner.id,
            JSON.stringify({
              summary: `RESET INVENTORY CLEAN — stok=0 + clear PR + clear movements + clear opname`,
              context: {
                purchase_items_unlinked: r1.rowCount,
                opname_lines_deleted: r2.rowCount,
                opname_sessions_deleted: r3.rowCount,
                inventory_movements_deleted: r4.rowCount,
                purchase_request_items_deleted: r5.rowCount,
                purchase_requests_deleted: r6.rowCount,
                ingredients_stock_reset: r7.rowCount,
              },
            }),
            JSON.stringify({
              outletId: owner.outlet_id,
              actorRole: "owner",
              triggeredBy: "scripts/reset-inventory-clean.ts",
            }),
          ],
        );
        console.log("✓ Audit log inserted");
      } else {
        console.warn("⚠️  No active owner found — audit log skipped");
      }

      await client.query("COMMIT");
      console.log("\n✅ COMMIT — Reset berhasil!\n");

      // Post-reset verification
      console.log("📊 Post-reset counts:");
      for (const [label, sql] of queries) {
        const r = await client.query(sql);
        console.log(`  ${label}: ${r.rows[0].count}`);
      }
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("\n❌ ROLLBACK — error during reset:");
      console.error(e);
      process.exit(1);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
