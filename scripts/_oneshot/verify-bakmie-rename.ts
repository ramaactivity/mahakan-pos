/**
 * Read-only verify: Bakmie "Ayam Sambal Matah" rename status + recipe content.
 * Run: npx tsx scripts/_oneshot/verify-bakmie-rename.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { isNull, sql } from "drizzle-orm";
import { outlets } from "@/db/schema";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set in .env.local");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  const [outlet] = await db.select().from(outlets).where(isNull(outlets.deletedAt)).limit(1);
  if (!outlet) throw new Error("No outlet");

  const items = await db.execute(sql`
    SELECT mi.id AS menu_id, mi.name, c.name AS category, mi.deleted_at,
           r.id AS recipe_id, r.is_active AS recipe_active,
           (SELECT COUNT(*) FROM recipe_ingredients WHERE recipe_id = r.id) AS line_count
    FROM menu_items mi
    LEFT JOIN categories c ON c.id = mi.category_id
    LEFT JOIN recipes r ON r.menu_item_id = mi.id AND r.is_active = true
    WHERE LOWER(mi.name) LIKE '%matah%' AND mi.outlet_id = ${outlet.id}::uuid
    ORDER BY c.display_order, mi.name
  `);

  console.log("=== Menu items + recipes ('matah') ===");
  for (const r of items.rows) {
    const dStatus = r.deleted_at ? "DELETED" : "active";
    const recipeInfo = r.recipe_id
      ? `recipe=${String(r.recipe_id).slice(0, 8)}.. lines=${r.line_count}`
      : "NO RECIPE";
    console.log(`  [${r.category}] "${r.name}" (${dStatus}) — ${recipeInfo}`);
  }

  // Inspect the Bakmie recipe content to confirm it's bakmie ingredients (not rice bowl).
  const bakmieItem = items.rows.find(
    (r) => r.category === "Bakmie" && r.recipe_id !== null,
  );
  if (bakmieItem) {
    const lines = await db.execute(sql`
      SELECT i.name, ri.qty, i.unit
      FROM recipe_ingredients ri
      JOIN ingredients i ON i.id = ri.ingredient_id
      WHERE ri.recipe_id = ${bakmieItem.recipe_id}::uuid
      ORDER BY i.name
    `);
    console.log(`\n=== Bakmie 'Ayam Sambal Matah' recipe content (${lines.rows.length} lines) ===`);
    for (const l of lines.rows) {
      console.log(`  • ${l.name} — ${l.qty} ${l.unit}`);
    }
  }

  console.log("\n=== Diagnosis ===");
  const ricebowlNew = items.rows.find(
    (r) => r.category === "Ricebowl" && (r.name as string).toLowerCase().includes("ricebowl ayam sambal matah"),
  );
  const bakmieNew = items.rows.find(
    (r) => r.category === "Bakmie" && (r.name as string).toLowerCase().includes("bakmie ayam sambal matah"),
  );
  if (ricebowlNew && bakmieNew) {
    console.log(`  ✅ Rename BERHASIL — both items punya nama dengan prefix kategori`);
    console.log(`     Bakmie "${bakmieNew.name}": recipe ${bakmieNew.recipe_id ? "ATTACHED" : "MISSING"} (${bakmieNew.line_count} lines)`);
    console.log(`     Ricebowl "${ricebowlNew.name}": recipe ${ricebowlNew.recipe_id ? "ATTACHED" : "MISSING"} (${ricebowlNew.line_count ?? 0} lines)`);
    if (!ricebowlNew.recipe_id) {
      console.log(`     ⚠️  Ricebowl version BELUM punya recipe — Owner perlu attach via Admin Resep`);
      console.log(`        atau via CSV import (data/source-spreadsheets/04-menu-recipes.csv).`);
    }
  } else {
    console.log(`  ⚠️  Salah satu item tidak ditemukan dengan nama berformat "{Category} Ayam Sambal Matah"`);
  }

  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
