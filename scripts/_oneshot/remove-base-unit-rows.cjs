/**
 * Sesi AE-176 — Soft-delete baris ingredient_units yang label-nya = satuan
 * DASAR bahan (qty_per_base=1). Satuan dasar implisit; row ini redundan dan
 * bikin opsi dropdown dobel ("PcsPcs"/"PackPcs") + potensi error save.
 * Aman: soft-delete (deleted_at) → FK supplier_ingredients tetap valid, loader
 * sudah filter deleted_at. Tidak menyentuh qty/harga.
 *
 * Dry-run : node scripts/_oneshot/remove-base-unit-rows.cjs
 * Eksekusi: node scripts/_oneshot/remove-base-unit-rows.cjs --confirm
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env.local") });
const { Pool } = require("@neondatabase/serverless");

const CONFIRM = process.argv.includes("--confirm");

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const target = await pool.query(`
    SELECT iu.id, ing.name, iu.label, ing.unit
    FROM ingredient_units iu
    JOIN ingredients ing ON ing.id = iu.ingredient_id
    WHERE iu.deleted_at IS NULL
      AND lower(trim(iu.label)) = lower(trim(ing.unit))
    ORDER BY ing.name
  `);
  console.log(`Baris ingredient_units = satuan dasar (redundan): ${target.rows.length}`);
  for (const r of target.rows) console.log(`  ${r.name}: "${r.label}" (= dasar "${r.unit}")`);

  if (!CONFIRM) {
    console.log("\nDRY-RUN. Jalankan dengan --confirm untuk soft-delete.");
    await pool.end();
    return;
  }

  const res = await pool.query(`
    UPDATE ingredient_units iu
    SET deleted_at = now(), is_default_buy = false, updated_at = now()
    FROM ingredients ing
    WHERE iu.ingredient_id = ing.id
      AND iu.deleted_at IS NULL
      AND lower(trim(iu.label)) = lower(trim(ing.unit))
  `);
  console.log(`\n✅ ${res.rowCount} baris base-unit di-soft-delete.`);
  await pool.end();
})().catch((e) => {
  console.error("GAGAL:", e);
  process.exit(1);
});
