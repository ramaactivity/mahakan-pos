/**
 * Sesi AE-176 — Hapus semua baris PREPARATION (Prep - X) dari sesi opname
 * in_progress. Preparation dibuat in-house dari resep → tidak dihitung fisik
 * di opname (anti double-count). Hanya hapus baris yang BELUM dihitung
 * (actual_qty NULL) untuk keamanan. Lalu sinkronkan total_lines sesi.
 *
 * Dry-run : node scripts/_oneshot/remove-prep-from-opname.cjs
 * Eksekusi: node scripts/_oneshot/remove-prep-from-opname.cjs --confirm
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env.local") });
const { Pool } = require("@neondatabase/serverless");

const CONFIRM = process.argv.includes("--confirm");

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const target = await pool.query(`
    SELECT sol.id
    FROM stock_opname_lines sol
    JOIN stock_opname_sessions sos ON sos.id = sol.session_id
    JOIN ingredients ing ON ing.id = sol.ingredient_id
    WHERE sos.status = 'in_progress'
      AND ing.is_preparation = true
      AND sol.actual_qty IS NULL
  `);
  console.log(`Baris prep (belum dihitung) yang akan dihapus: ${target.rows.length}`);

  const counted = await pool.query(`
    SELECT ing.name FROM stock_opname_lines sol
    JOIN stock_opname_sessions sos ON sos.id = sol.session_id
    JOIN ingredients ing ON ing.id = sol.ingredient_id
    WHERE sos.status='in_progress' AND ing.is_preparation=true AND sol.actual_qty IS NOT NULL
  `);
  if (counted.rows.length > 0) {
    console.log(`⚠️  ${counted.rows.length} baris prep SUDAH dihitung → DILEWATI (tidak dihapus):`,
      counted.rows.map((r) => r.name).join(", "));
  }

  if (!CONFIRM) {
    console.log("\nDRY-RUN. Jalankan dengan --confirm untuk menghapus.");
    await pool.end();
    return;
  }

  const del = await pool.query(`
    DELETE FROM stock_opname_lines sol
    USING stock_opname_sessions sos, ingredients ing
    WHERE sol.session_id = sos.id
      AND sol.ingredient_id = ing.id
      AND sos.status = 'in_progress'
      AND ing.is_preparation = true
      AND sol.actual_qty IS NULL
  `);

  // Sinkronkan total_lines sesi in_progress ke jumlah baris tersisa.
  const sync = await pool.query(`
    UPDATE stock_opname_sessions sos
    SET total_lines = (SELECT count(*) FROM stock_opname_lines WHERE session_id = sos.id)
    WHERE sos.status = 'in_progress'
  `);

  console.log(`✅ ${del.rowCount} baris prep dihapus. total_lines ${sync.rowCount} sesi disinkronkan.`);
  await pool.end();
})().catch((e) => {
  console.error("GAGAL:", e);
  process.exit(1);
});
