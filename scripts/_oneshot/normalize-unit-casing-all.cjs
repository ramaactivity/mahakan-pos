/**
 * Sesi AE-176 — Samakan EJAAN/CASE satuan di SELURUH sistem ke bentuk kanonik
 * (mirror displayUnit / UNIT_TABLE). Karena semua satuan dari dropdown (tak ada
 * ketik manual), data sebaiknya 1 ejaan: kg→Kg, g→gr, l→L, pcs→Pcs, pack→Pack,
 * btl→Btl. Satuan custom (renceng/sachet/kaleng/dus/pail/...) tak dikenal
 * UNIT_TABLE → dibiarkan apa adanya (audit: sudah konsisten).
 *
 * Deterministik & aman: canon() dipakai SERAGAM di semua kolom, jadi referensi
 * silang antar tabel (pack_conversions ↔ ingredient_units ↔ supplier ↔ opname)
 * tetap cocok. TIDAK mengubah angka/qty apa pun.
 *
 * Dry-run : node scripts/_oneshot/normalize-unit-casing-all.cjs
 * Eksekusi: node scripts/_oneshot/normalize-unit-casing-all.cjs --confirm
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env.local") });
const { Pool } = require("@neondatabase/serverless");

const CONFIRM = process.argv.includes("--confirm");

/* Mirror UNIT_TABLE (src/lib/unit-conversion.ts) — lowercased key → label. */
const CANON = {
  kg: "Kg",
  gr: "gr",
  g: "gr",
  l: "L",
  liter: "L",
  ml: "ml",
  lusin: "Lusin",
  pcs: "Pcs",
  btl: "Btl",
  pack: "Pack",
  packs: "Pack", // satukan jamak → singular (hindari split Pack/Packs)
  bks: "Bks",
  krat: "Krat",
  karton: "Karton",
  sdm: "Sdm",
  sdt: "Sdt",
  box: "Box",
  porsi: "porsi",
};
function canon(u) {
  if (u == null) return u;
  const t = String(u).trim();
  if (t === "") return t;
  const m = CANON[t.toLowerCase()];
  return m ?? t;
}

/* Kolom TEXT satuan (tabel, kolom). EXCLUDE modifiers/payroll label. */
const TEXT_COLS = [
  ["ingredients", "unit"],
  ["ingredients", "unit_belanja"],
  ["ingredients", "unit_tracking"],
  ["ingredient_units", "label"],
  ["ingredient_units", "ref_unit_label"],
  ["supplier_ingredients", "pack_unit"],
  ["stock_opname_lines", "unit_snapshot"],
  ["goods_receipt_items", "unit_snapshot"],
  ["purchase_items", "unit_snapshot"],
  ["purchase_items", "unit_override"],
  ["purchase_request_items", "unit_snapshot"],
];

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let totalText = 0;
  const plan = [];

  for (const [table, col] of TEXT_COLS) {
    const r = await pool.query(
      `SELECT DISTINCT ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL`,
    );
    for (const row of r.rows) {
      const c = canon(row.v);
      if (c !== row.v) {
        const cnt = await pool.query(
          `SELECT count(*)::int n FROM ${table} WHERE ${col} = $1`,
          [row.v],
        );
        plan.push({ table, col, from: row.v, to: c, n: cnt.rows[0].n });
        totalText += cnt.rows[0].n;
      }
    }
  }

  // pack_conversions jsonb.
  const pcRows = await pool.query(
    `SELECT id, pack_conversions FROM ingredients WHERE pack_conversions IS NOT NULL`,
  );
  const pcChanges = [];
  for (const row of pcRows.rows) {
    const arr = row.pack_conversions;
    if (!Array.isArray(arr)) continue;
    let changed = false;
    const next = arr.map((e) => {
      const c = canon(e.unitLabel);
      if (c !== e.unitLabel) changed = true;
      return { ...e, unitLabel: c };
    });
    if (changed) pcChanges.push({ id: row.id, next });
  }

  console.log("=== RENCANA NORMALISASI CASE SATUAN ===");
  for (const p of plan) {
    console.log(`  ${p.table}.${p.col}: "${p.from}" → "${p.to}" (${p.n} baris)`);
  }
  console.log(`  pack_conversions (jsonb): ${pcChanges.length} bahan`);
  console.log(`Total baris text: ${totalText}`);

  if (!CONFIRM) {
    console.log("\nDRY-RUN. Jalankan dengan --confirm untuk menerapkan.");
    await pool.end();
    return;
  }

  let applied = 0;
  for (const p of plan) {
    const res = await pool.query(
      `UPDATE ${p.table} SET ${p.col} = $1 WHERE ${p.col} = $2`,
      [p.to, p.from],
    );
    applied += res.rowCount;
  }
  for (const c of pcChanges) {
    await pool.query(`UPDATE ingredients SET pack_conversions = $1 WHERE id = $2`, [
      JSON.stringify(c.next),
      c.id,
    ]);
  }
  console.log(`\n✅ ${applied} baris text + ${pcChanges.length} pack_conversions dinormalisasi.`);
  await pool.end();
})().catch((e) => {
  console.error("GAGAL:", e);
  process.exit(1);
});
