/**
 * Sesi AE-62v — sanity check sebelum apply CHECK constraint
 * `ingredients.current_stock >= 0` + `current_stock_decimal >= 0`.
 *
 * Cari ingredient rows yang punya negative stock (silent oversell tracker).
 * Kalau ada, owner harus resolve dulu (set ke 0 atau opname manual)
 * sebelum migration apply. Otherwise migration fail.
 *
 * Read-only. Run: npx tsx scripts/_oneshot/check-negative-stock.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    console.log("=== Check: ingredients.current_stock < 0 ===");
    const negBigint = await c.query(`
      SELECT id, outlet_id, name, unit, section,
             current_stock, current_stock_decimal,
             cost_per_unit, is_active, updated_at
      FROM ingredients
      WHERE current_stock < 0
        AND deleted_at IS NULL
      ORDER BY current_stock ASC
      LIMIT 50
    `);
    if (negBigint.rows.length === 0) {
      console.log("  OK: no rows dengan current_stock negative.");
    } else {
      console.log(`  FOUND ${negBigint.rows.length} ingredient(s) dengan stock negative:`);
      for (const r of negBigint.rows) {
        console.log(
          `    ${String(r.id).slice(0, 8)} | ${String(r.name).padEnd(28)} | section=${r.section ?? "-"} | bigint=${r.current_stock} ${r.unit} | decimal=${r.current_stock_decimal ?? "NULL"} | active=${r.is_active}`,
        );
      }
    }

    console.log("\n=== Check: ingredients.current_stock_decimal < 0 ===");
    const negDecimal = await c.query(`
      SELECT id, outlet_id, name, unit,
             current_stock, current_stock_decimal
      FROM ingredients
      WHERE current_stock_decimal IS NOT NULL
        AND current_stock_decimal < 0
        AND deleted_at IS NULL
      ORDER BY current_stock_decimal ASC
      LIMIT 50
    `);
    if (negDecimal.rows.length === 0) {
      console.log("  OK: no rows dengan current_stock_decimal negative.");
    } else {
      console.log(`  FOUND ${negDecimal.rows.length} ingredient(s) dengan decimal negative:`);
      for (const r of negDecimal.rows) {
        console.log(
          `    ${String(r.id).slice(0, 8)} | ${String(r.name).padEnd(28)} | bigint=${r.current_stock} | decimal=${r.current_stock_decimal} ${r.unit}`,
        );
      }
    }

    console.log("\n=== Summary ===");
    const negCount = negBigint.rows.length + negDecimal.rows.length;
    if (negCount === 0) {
      console.log("✓ Safe untuk apply CHECK constraint (no negative rows).");
    } else {
      console.log(`✗ Resolve ${negCount} negative row(s) dulu sebelum migrate.`);
      console.log(
        "  Options: opname manual (recommended), atau UPDATE ingredients SET current_stock = 0, current_stock_decimal = 0 WHERE current_stock < 0;",
      );
      console.log(
        "  Alternative: apply ADD CONSTRAINT ... NOT VALID (existing rows tetap pass, future writes di-check). Lihat migration.",
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
