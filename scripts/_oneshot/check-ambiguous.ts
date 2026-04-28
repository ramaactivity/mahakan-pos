import { config } from "dotenv";
config({ path: ".env.local" });
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { recipes, outlets } from "@/db/schema";

async function main() {
  const [outlet] = await db.select().from(outlets).where(isNull(outlets.deletedAt)).limit(1);
  if (!outlet) throw new Error("No outlet");

  const dups = await db.execute(sql`
    SELECT mi.id, mi.name, c.name AS category, mi.price_type
    FROM menu_items mi
    LEFT JOIN categories c ON c.id = mi.category_id
    WHERE LOWER(TRIM(mi.name))='ayam sambal matah' AND mi.outlet_id=${outlet.id}::uuid
  `);
  console.log("All 'Ayam Sambal Matah' rows:");
  for (const r of dups.rows) console.log(`  ${r.id} — ${r.name} [${r.category}]`);

  for (const r of dups.rows) {
    const recs = await db
      .select({ id: recipes.id, variant: recipes.variant })
      .from(recipes)
      .where(and(eq(recipes.menuItemId, r.id as string), eq(recipes.isActive, true)));
    console.log(`  → ${recs.length} recipe(s) attached: ${JSON.stringify(recs)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
