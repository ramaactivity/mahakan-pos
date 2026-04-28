/**
 * Surgical fix: the recipe with content "Rice Bowl Matah" (Prep - Ayam Popcorn
 * + Prep - Sambal Matah + Prep - Nasi + bowl/utensils) was imported under
 * Bakmie's "Ayam Sambal Matah" menu_item_id due to engine map last-seen-wins
 * bug (both Ricebowl + Bakmie have menu_items with the same name). Move the
 * recipe to Ricebowl's menu_item_id, where it semantically belongs.
 *
 * This leaves Bakmie's "Ayam Sambal Matah" without a recipe, which Owner
 * must address via Admin UI (rename to "Bakmie Sambal Matah" + re-import).
 *
 * Run: npx tsx scripts/_oneshot/fix-ricebowl-matah-attachment.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { recipes, outlets, users } from "@/db/schema";

async function main() {
  const [outlet] = await db.select().from(outlets).where(isNull(outlets.deletedAt)).limit(1);
  if (!outlet) throw new Error("No outlet");

  const ownerEmail = process.env.SEED_OWNER_EMAIL;
  if (!ownerEmail) throw new Error("SEED_OWNER_EMAIL not set");
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, ownerEmail)).limit(1);
  if (!user) throw new Error("Actor not found");

  // Find both menu_items.
  const matches = await db.execute(sql`
    SELECT mi.id, c.name AS category, mi.category_id
    FROM menu_items mi
    LEFT JOIN categories c ON c.id = mi.category_id
    WHERE LOWER(TRIM(mi.name))='ayam sambal matah' AND mi.outlet_id=${outlet.id}::uuid
    ORDER BY c.display_order
  `);
  let ricebowlId: string | null = null;
  let bakmieId: string | null = null;
  for (const r of matches.rows) {
    if ((r.category as string) === "Ricebowl") ricebowlId = r.id as string;
    if ((r.category as string) === "Bakmie") bakmieId = r.id as string;
  }
  if (!ricebowlId || !bakmieId) {
    throw new Error(`Missing menu_item: ricebowl=${ricebowlId}, bakmie=${bakmieId}`);
  }
  console.log(`Ricebowl menu_item: ${ricebowlId}`);
  console.log(`Bakmie menu_item:   ${bakmieId}`);

  // Find the recipe currently on Bakmie's id.
  const [misRecipe] = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(
      and(
        eq(recipes.outletId, outlet.id),
        eq(recipes.menuItemId, bakmieId),
        isNull(recipes.variant),
        eq(recipes.isActive, true),
      ),
    )
    .limit(1);
  if (!misRecipe) {
    console.log("No recipe attached to Bakmie 'Ayam Sambal Matah' — nothing to fix.");
    process.exit(0);
  }
  console.log(`Found mis-attached recipe: ${misRecipe.id}`);

  // Move it to Ricebowl's id.
  await db
    .update(recipes)
    .set({
      menuItemId: ricebowlId,
      updatedBy: user.id,
      updatedAt: new Date(),
      notes: "M23.5 fix: re-attached from Bakmie to Ricebowl due to ambiguous menu_item.name during import",
    })
    .where(eq(recipes.id, misRecipe.id));
  console.log(`Recipe ${misRecipe.id} → moved to Ricebowl menu_item ${ricebowlId}.`);

  console.log("\nNote: Bakmie 'Ayam Sambal Matah' now has NO recipe. Owner action:");
  console.log("  1. /admin → Menu → rename Bakmie 'Ayam Sambal Matah' to e.g. 'Bakmie Sambal Matah'");
  console.log("  2. Add 'Bakmie Sambal Matah' to data/source-spreadsheets/04-menu-recipes.csv");
  console.log("  3. Add lines (Mie + Prep - Ayam Panggang 65g + Prep - Sambal Matah 73g + Prep - Kuah Bakmie 190ml + Paper Bowl + Sumpit) to 05-menu-recipe-lines.csv");
  console.log("  4. Re-run npm run inventory:import -- --apply (idempotent UPDATE)");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
