/**
 * Sesi AE-62z — sanity check historical_expense untuk identifikasi duplicate
 * rows yang sudah ada (kalau owner pernah re-upload CSV). Output groupkan
 * by fingerprint canonical (outlet, businessDate, categoryId, amount,
 * description-trim-lc).
 *
 * Read-only. Run: npx tsx scripts/_oneshot/check-historical-expense-dupes.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    console.log("=== Check: historical_expense duplicates ===");
    const dupes = await c.query(`
      SELECT
        outlet_id,
        business_date,
        COALESCE(category_id::text, '-') AS category,
        COALESCE(category_label_legacy, '-') AS category_label,
        amount,
        COALESCE(LOWER(TRIM(description)), '-') AS desc_key,
        COUNT(*) AS cnt,
        ARRAY_AGG(id ORDER BY created_at) AS row_ids,
        ARRAY_AGG(created_at ORDER BY created_at) AS created_ats
      FROM historical_expense
      GROUP BY outlet_id, business_date, category, category_label, amount, desc_key
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC, business_date DESC
      LIMIT 50
    `);
    if (dupes.rows.length === 0) {
      console.log("  OK: tidak ada duplicate.");
    } else {
      console.log(`  FOUND ${dupes.rows.length} group(s) duplicate:`);
      for (const r of dupes.rows) {
        console.log(
          `    ${r.business_date} | cat=${r.category.slice(0, 8)} (${r.category_label.slice(0, 20)}) | ${Number(r.amount).toLocaleString("id-ID")} | "${r.desc_key.slice(0, 30)}" | cnt=${r.cnt}`,
        );
      }
    }

    console.log("\n=== Total rows ===");
    const totalRes = await c.query(
      `SELECT COUNT(*) AS cnt FROM historical_expense`,
    );
    console.log(`  ${totalRes.rows[0].cnt} historical_expense rows total.`);

    console.log("\n=== Summary ===");
    if (dupes.rows.length === 0) {
      console.log("✓ Safe untuk apply UNIQUE constraint (no existing dupes).");
    } else {
      console.log(
        `✗ Resolve ${dupes.rows.length} duplicate group(s) dulu. Options:`,
      );
      console.log(
        "  - Manual: hapus salah satu per group via Admin → Riwayat Akuntansi",
      );
      console.log(
        "  - Auto: keep oldest, delete newer. Run script lain dengan flag --auto-resolve",
      );
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
