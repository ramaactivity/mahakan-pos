/**
 * Sesi AE-175 — Backfill tabel ternormalisasi `ingredient_units` dari kolom
 * lama `ingredients.unit_belanja/unit_belanja_per_cogs/pack_conversions`, lalu
 * set `supplier_ingredients.ingredient_unit_id` saat label cocok.
 *
 * Idempotent: bahan yang SUDAH punya ingredient_units aktif di-skip.
 * Mismatch (mis. Chocolatos packUnit=gr 200 vs unit renceng 280) → DILAPORKAN,
 * tidak ditebak; owner perbaiki via modal "Kelola Bahan".
 *
 * READ-ONLY (DRY-RUN) default. Pakai --confirm untuk eksekusi (single tx).
 *
 * Usage:
 *   npx tsx scripts/_oneshot/backfill-ingredient-units.ts
 *   npx tsx scripts/_oneshot/backfill-ingredient-units.ts --confirm
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

interface UnitRow {
  label: string;
  qtyPerBase: number;
  isDefaultBuy: boolean;
}

function buildUnits(
  unitBelanja: string | null,
  perCogs: string | number | null,
  packConversions: unknown,
): UnitRow[] {
  const out: UnitRow[] = [];
  const seen = new Set<string>();
  const per = perCogs == null ? null : Number(perCogs);
  if (unitBelanja && per && per > 0) {
    out.push({ label: unitBelanja, qtyPerBase: per, isDefaultBuy: true });
    seen.add(unitBelanja.trim().toLowerCase());
  }
  if (Array.isArray(packConversions)) {
    for (const p of packConversions) {
      const label = String(p?.unitLabel ?? "").trim();
      const qty = Number(p?.qtyPerBase);
      const lc = label.toLowerCase();
      if (label.length === 0 || seen.has(lc)) continue;
      if (!Number.isFinite(qty) || qty <= 0) continue;
      seen.add(lc);
      out.push({ label, qtyPerBase: qty, isDefaultBuy: false });
    }
  }
  return out;
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  console.log("═".repeat(68));
  console.log(
    `BACKFILL ingredient_units — Mode: ${confirmed ? "🔥 EXECUTE (--confirm)" : "🔍 DRY-RUN"}`,
  );
  console.log("═".repeat(68));

  const ings = await pool.query(
    `SELECT id, outlet_id, name, unit, unit_belanja, unit_belanja_per_cogs, pack_conversions
     FROM ingredients WHERE deleted_at IS NULL ORDER BY name`,
  );

  let toInsert = 0;
  let skippedExisting = 0;
  const plan: Array<{ ingId: string; outletId: string; rows: UnitRow[] }> = [];

  for (const i of ings.rows) {
    const existing = await pool.query(
      `SELECT count(*)::int n FROM ingredient_units WHERE ingredient_id=$1 AND deleted_at IS NULL`,
      [i.id],
    );
    if ((existing.rows[0]?.n ?? 0) > 0) {
      skippedExisting++;
      continue;
    }
    const rows = buildUnits(i.unit_belanja, i.unit_belanja_per_cogs, i.pack_conversions);
    if (rows.length === 0) continue;
    plan.push({ ingId: i.id, outletId: i.outlet_id, rows });
    toInsert += rows.length;
  }

  console.log(`\nBahan: ${ings.rows.length} | sudah ada unit (skip): ${skippedExisting}`);
  console.log(`Akan insert ${toInsert} baris ingredient_units untuk ${plan.length} bahan.`);
  for (const p of plan.slice(0, 30)) {
    const name = ings.rows.find((x) => x.id === p.ingId)?.name;
    console.log(
      `  • ${name}: ${p.rows.map((r) => `${r.label}=${r.qtyPerBase}${r.isDefaultBuy ? "*" : ""}`).join(", ")}`,
    );
  }
  if (plan.length > 30) console.log(`  … +${plan.length - 30} bahan lagi`);

  // ── Link supplier_ingredients ke ingredient_units (preview akurat) ───
  const sis = await pool.query(
    `SELECT si.id, si.ingredient_id, si.pack_unit, i.unit AS base_unit, i.name
     FROM supplier_ingredients si JOIN ingredients i ON i.id=si.ingredient_id
     WHERE si.deleted_at IS NULL AND si.ingredient_unit_id IS NULL`,
  );
  /* Label map = unit yang DIRENCANAKAN (plan) + unit yang sudah ada di DB
   * (bahan ter-skip). Supaya preview akurat tanpa insert dulu. */
  const labelMap = new Map<string, Set<string>>();
  for (const p of plan) {
    labelMap.set(p.ingId, new Set(p.rows.map((r) => r.label.trim().toLowerCase())));
  }
  const existingUnits = await pool.query(
    `SELECT ingredient_id, lower(label) AS lc FROM ingredient_units WHERE deleted_at IS NULL`,
  );
  for (const u of existingUnits.rows) {
    const s = labelMap.get(u.ingredient_id) ?? new Set<string>();
    s.add(u.lc);
    labelMap.set(u.ingredient_id, s);
  }
  const mismatches: string[] = [];
  let linkable = 0;
  let baseUnitEntries = 0;

  if (confirmed) await pool.query("BEGIN");
  try {
    if (confirmed) {
      for (const p of plan) {
        for (let k = 0; k < p.rows.length; k++) {
          const r = p.rows[k]!;
          await pool.query(
            `INSERT INTO ingredient_units (outlet_id, ingredient_id, label, qty_per_base, is_default_buy, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [p.outletId, p.ingId, r.label, r.qtyPerBase.toFixed(4), r.isDefaultBuy, k],
          );
        }
      }
    }

    for (const si of sis.rows) {
      const pu = String(si.pack_unit ?? "").trim().toLowerCase();
      const base = String(si.base_unit ?? "").trim().toLowerCase();
      if (pu === base) {
        baseUnitEntries++;
        continue; // resolver fallback 1:1, biarkan NULL
      }
      const labels = labelMap.get(si.ingredient_id);
      if (labels && labels.has(pu)) {
        linkable++;
        if (confirmed) {
          const u = await pool.query(
            `SELECT id FROM ingredient_units
             WHERE ingredient_id=$1 AND lower(label)=$2 AND deleted_at IS NULL LIMIT 1`,
            [si.ingredient_id, pu],
          );
          if (u.rows.length > 0) {
            await pool.query(
              `UPDATE supplier_ingredients SET ingredient_unit_id=$1, updated_at=now() WHERE id=$2`,
              [u.rows[0].id, si.id],
            );
          }
        }
      } else {
        mismatches.push(`${si.name}: entri pakai "${si.pack_unit}" — tak ada satuan cocok`);
      }
    }

    if (confirmed) {
      await pool.query("COMMIT");
      console.log("\n✅ Backfill committed.");
    }
  } catch (e) {
    if (confirmed) await pool.query("ROLLBACK");
    console.error("❌ Gagal — ROLLBACK:", e);
    await pool.end();
    process.exit(1);
  }

  console.log("\n── Link supplier_ingredients → ingredient_units ──");
  console.log(`  Bisa di-link: ${linkable} | entri pakai satuan dasar (NULL ok): ${baseUnitEntries}`);
  console.log(`  ⚠️ MISMATCH (perlu owner perbaiki via modal): ${mismatches.length}`);
  mismatches.slice(0, 20).forEach((m) => console.log(`     - ${m}`));

  if (!confirmed) {
    console.log("\nℹ️  DRY-RUN — tidak ada perubahan. Jalankan --confirm untuk eksekusi.");
  }
  await pool.end();
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
