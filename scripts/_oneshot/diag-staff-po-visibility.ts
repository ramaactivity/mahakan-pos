import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  const rows = (r: any) => (r as any).rows ?? r;

  const totals = await db.execute(sql`
    SELECT
      count(*)::int AS total_aktif,
      count(*) FILTER (WHERE reorder_threshold IS NOT NULL)::int AS punya_threshold,
      count(*) FILTER (WHERE reorder_threshold IS NULL)::int AS threshold_null,
      count(*) FILTER (WHERE reorder_threshold IS NOT NULL
                         AND current_stock <= reorder_threshold)::int AS muncul_di_staff_po
    FROM ingredients
    WHERE is_active = true AND deleted_at IS NULL
  `);
  console.log("\n=== VISIBILITAS BAHAN DI MODUL PO STAFF ===");
  console.table(rows(totals));

  const cari = await db.execute(sql`
    SELECT name, unit, current_stock, reorder_threshold, is_active, deleted_at IS NOT NULL AS dihapus,
           (is_active AND deleted_at IS NULL AND reorder_threshold IS NOT NULL
            AND current_stock <= reorder_threshold) AS muncul_di_staff_po
    FROM ingredients
    WHERE name ILIKE '%oreo%' OR name ILIKE '%regal%' OR name ILIKE '%nugget%'
       OR name ILIKE '%mclewis%' OR name ILIKE '%saus%'
    ORDER BY name
  `);
  console.log("\n=== BAHAN YANG DICARI STAFF (Oreo / Regal / Nugget / Saus) ===");
  console.table(rows(cari));

  const sample = await db.execute(sql`
    SELECT name, section, unit, current_stock, reorder_threshold
    FROM ingredients
    WHERE is_active = true AND deleted_at IS NULL AND reorder_threshold IS NULL
    ORDER BY name
    LIMIT 25
  `);
  console.log("\n=== CONTOH BAHAN TANPA reorder_threshold (INVISIBLE) ===");
  console.table(rows(sample));

  const manual = await db.execute(sql`
    SELECT pri.ingredient_name_snapshot, pri.unit_snapshot, count(*)::int AS jml_pr
    FROM purchase_request_items pri
    WHERE pri.ingredient_id IS NULL
    GROUP BY 1, 2
    ORDER BY 3 DESC
    LIMIT 30
  `);
  console.log("\n=== ITEM PR YANG MANUAL (ingredient_id NULL) ===");
  console.table(rows(manual));

  const manualCocok = await db.execute(sql`
    SELECT pri.ingredient_name_snapshot AS nama_manual,
           i.name AS ada_di_master, i.unit AS satuan_master
    FROM (SELECT DISTINCT ingredient_name_snapshot FROM purchase_request_items WHERE ingredient_id IS NULL) pri
    JOIN ingredients i
      ON lower(trim(i.name)) = lower(trim(pri.ingredient_name_snapshot))
     AND i.is_active = true AND i.deleted_at IS NULL
    ORDER BY 1
  `);
  console.log("\n=== ITEM MANUAL YANG SEBENARNYA ADA DI MASTER (harusnya ke-link) ===");
  console.table(rows(manualCocok));

  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
