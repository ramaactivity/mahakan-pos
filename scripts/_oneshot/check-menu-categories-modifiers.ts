/**
 * Sesi AE-62ak — Read-only audit untuk lihat menu structure Mahakan:
 *  - Categories aktif
 *  - Modifiers (add-ons) aktif
 *  - Top 20 menu items
 *
 * Tujuan: pastikan MotivasiBanner tip-tip refer ke item yang ADA, bukan
 * ngasal "Donut/Croffle" yang tidak ada di menu.
 *
 * Run: npx tsx scripts/_oneshot/check-menu-categories-modifiers.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "@neondatabase/serverless";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    console.log("=== Categories aktif ===");
    const cats = await c.query(`
      SELECT name, display_order
      FROM categories
      WHERE is_active = true AND deleted_at IS NULL
      ORDER BY display_order, name
    `);
    for (const r of cats.rows) console.log(`  • ${r.name}`);
    console.log(`  TOTAL: ${cats.rows.length}\n`);

    console.log("=== Modifiers (Add-ons) ===");
    const mods = await c.query(`
      SELECT slug, label, type, price, applies_to_categories, options_json
      FROM modifiers
      WHERE is_active = true
      ORDER BY label
    `);
    for (const r of mods.rows) {
      const applies = r.applies_to_categories?.join(", ") ?? "all";
      const opts = r.options_json
        ? (r.options_json as { label: string }[])
            .map((o) => o.label)
            .join(" / ")
        : "(toggle)";
      console.log(
        `  • ${r.label} (${r.slug}) — type=${r.type} price=${r.price} applies=[${applies}] opts=${opts}`,
      );
    }
    console.log(`  TOTAL: ${mods.rows.length}\n`);

    console.log("=== Top 30 menu items (by name) ===");
    const items = await c.query(`
      SELECT mi.name, c.name AS category, mi.price_type, mi.is_signature
      FROM menu_items mi
      JOIN categories c ON c.id = mi.category_id
      WHERE mi.is_active = true AND mi.deleted_at IS NULL
      ORDER BY c.name, mi.name
      LIMIT 60
    `);
    let lastCat = "";
    for (const r of items.rows) {
      if (r.category !== lastCat) {
        console.log(`\n  [${r.category}]`);
        lastCat = r.category;
      }
      const sig = r.is_signature ? " ⭐" : "";
      console.log(`    • ${r.name}${sig}`);
    }
    console.log(`\n  TOTAL: ${items.rows.length}`);
  } finally {
    c.release();
    await pool.end();
  }
}
void main();
