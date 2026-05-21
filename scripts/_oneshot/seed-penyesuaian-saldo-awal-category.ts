/**
 * Sesi AE-70 — Backfill kategori "Penyesuaian Saldo Awal" untuk outlet
 * Mahakan existing.
 *
 * seed-data.ts sudah include kategori ini sebagai isSystem=true untuk
 * outlet baru, tapi outlet Mahakan sudah running sebelum seed di-update.
 * Script ini insert manual.
 *
 * Usage:
 *   npx tsx scripts/_oneshot/seed-penyesuaian-saldo-awal-category.ts          # DRY
 *   npx tsx scripts/_oneshot/seed-penyesuaian-saldo-awal-category.ts --apply  # FIX
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    const outlets = await c.query(
      `SELECT id, name FROM outlets WHERE deleted_at IS NULL`,
    );
    console.log(`Outlets: ${outlets.rows.length}`);

    let toInsert = 0;
    for (const o of outlets.rows) {
      const existing = await c.query(
        `SELECT id FROM expense_categories
         WHERE outlet_id = $1 AND name = 'Penyesuaian Saldo Awal' AND deleted_at IS NULL`,
        [o.id],
      );
      if (existing.rows.length > 0) {
        console.log(`  ✓ ${o.name} — already has kategori`);
        continue;
      }
      console.log(`  → ${o.name} — MISSING kategori, will insert`);
      toInsert++;
    }

    if (toInsert === 0) {
      console.log("\n✅ No outlets need backfill.");
      return;
    }

    if (!apply) {
      console.log(
        `\nDRY-RUN. Re-run dengan --apply untuk insert ${toInsert} kategori.`,
      );
      return;
    }

    console.log("\nApplying insert...\n");
    await c.query("BEGIN");
    try {
      for (const o of outlets.rows) {
        const existing = await c.query(
          `SELECT id FROM expense_categories
           WHERE outlet_id = $1 AND name = 'Penyesuaian Saldo Awal' AND deleted_at IS NULL`,
          [o.id],
        );
        if (existing.rows.length > 0) continue;
        await c.query(
          `INSERT INTO expense_categories (outlet_id, name, is_system, display_order, created_at, updated_at)
           VALUES ($1, 'Penyesuaian Saldo Awal', true, 98, now(), now())`,
          [o.id],
        );
        console.log(`  ✓ inserted untuk ${o.name}`);
      }
      await c.query("COMMIT");
      console.log("\n✅ Done.");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
