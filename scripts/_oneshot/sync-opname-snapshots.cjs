/**
 * Sesi AE-176 — Selaraskan snapshot baris opname sesi in_progress ke MASTER
 * sekarang (nama, satuan, biaya). Sesi opname dimulai sebelum koreksi
 * satuan/cost massal → snapshot basi bikin "Terpakai (Rp)" meleset jutaan
 * (mis. Bawang Merah cost beku 4.900/gr vs master 80/gr).
 *
 * Aman & idempoten: hanya mengganti 3 kolom snapshot ke nilai master terkini.
 * TIDAK mengubah actual_qty (hasil hitung staf) atau apa pun yang lain.
 *
 * Dry-run : node scripts/_oneshot/sync-opname-snapshots.cjs
 * Eksekusi: node scripts/_oneshot/sync-opname-snapshots.cjs --confirm
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env.local") });
const { Pool } = require("@neondatabase/serverless");

const CONFIRM = process.argv.includes("--confirm");

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const stale = await pool.query(`
    SELECT count(*)::int AS n
    FROM stock_opname_lines sol
    JOIN stock_opname_sessions sos ON sos.id = sol.session_id
    JOIN ingredients ing ON ing.id = sol.ingredient_id
    WHERE sos.status = 'in_progress'
      AND (sol.unit_cost_at_snapshot <> ing.cost_per_unit
           OR lower(coalesce(sol.unit_snapshot,'')) <> lower(coalesce(ing.unit,''))
           OR sol.ingredient_name_snapshot <> ing.name)
  `);
  console.log(`Baris snapshot basi (in_progress): ${stale.rows[0].n}`);

  if (!CONFIRM) {
    console.log("\nDRY-RUN. Jalankan dengan --confirm untuk menerapkan.");
    await pool.end();
    return;
  }

  const res = await pool.query(`
    UPDATE stock_opname_lines sol
    SET unit_snapshot = ing.unit,
        ingredient_name_snapshot = ing.name,
        unit_cost_at_snapshot = ing.cost_per_unit
    FROM ingredients ing, stock_opname_sessions sos
    WHERE sol.ingredient_id = ing.id
      AND sol.session_id = sos.id
      AND sos.status = 'in_progress'
      AND (sol.unit_cost_at_snapshot <> ing.cost_per_unit
           OR lower(coalesce(sol.unit_snapshot,'')) <> lower(coalesce(ing.unit,''))
           OR sol.ingredient_name_snapshot <> ing.name)
  `);
  console.log(`✅ ${res.rowCount} baris disinkronkan ke master.`);
  await pool.end();
})().catch((e) => {
  console.error("GAGAL:", e);
  process.exit(1);
});
