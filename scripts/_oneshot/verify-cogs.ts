/**
 * Read-only: simulate COGS for sample menus by expanding recipes to atomic
 * leaves + applying menu Q-factor. Compare with Owner's HPP spreadsheet
 * display values.
 *
 * Run: npx tsx scripts/_oneshot/verify-cogs.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { ingredients, menuItems, outlets, recipes } from "@/db/schema";
import { expandRecipeToAtomicLeaves } from "@/features/inventory/preparation-flow";

const SAMPLES: Array<{ name: string; variant: "hot" | "iced" | null; ownerExpected: number; note: string }> = [
  { name: "Americano", variant: "iced", ownerExpected: 4274, note: "Iced Americano: Owner display TOTAL COST Rp 4.274 (with Q 30%)" },
  { name: "Americano", variant: "hot", ownerExpected: 5034, note: "Hot Americano: Owner display Rp 5.034" },
  { name: "Pablo Eskopi", variant: "iced", ownerExpected: 9785, note: "Pablo Eskopi: Owner display Rp 9.785" },
  { name: "Mont Blanc", variant: null, ownerExpected: 8682, note: "Mont Blanc: Owner display Rp 8.682" },
  { name: "Churros Choco Dip", variant: null, ownerExpected: 8177, note: "Churros: Owner display Rp 8.177" },
  { name: "Ayam Asam Manis", variant: null, ownerExpected: 12206, note: "Ricebowl Asam Manis: Owner display Rp 12.206" },
  { name: "Ayam Original", variant: null, ownerExpected: 15945, note: "Bakmie Original: Owner display Rp 15.945" },
];

async function main() {
  const [outlet] = await db.select().from(outlets).where(isNull(outlets.deletedAt)).limit(1);
  if (!outlet) throw new Error("No outlet");
  console.log(`Outlet: ${outlet.name}\n`);

  for (const s of SAMPLES) {
    const [menu] = await db
      .select({ id: menuItems.id, name: menuItems.name })
      .from(menuItems)
      .where(
        and(
          eq(menuItems.outletId, outlet.id),
          sql`LOWER(TRIM(${menuItems.name})) = ${s.name.toLowerCase()}`,
          isNull(menuItems.deletedAt),
        ),
      )
      .limit(1);
    if (!menu) {
      console.log(`SKIP: ${s.name} — menu_item not found`);
      continue;
    }

    const [recipe] = await db
      .select({ id: recipes.id, wasteFactorPct: recipes.wasteFactorPct })
      .from(recipes)
      .where(
        and(
          eq(recipes.outletId, outlet.id),
          eq(recipes.menuItemId, menu.id),
          s.variant === null ? isNull(recipes.variant) : eq(recipes.variant, s.variant),
          eq(recipes.isActive, true),
        ),
      )
      .limit(1);
    if (!recipe) {
      console.log(`SKIP: ${s.name} (${s.variant ?? "fixed"}) — no recipe`);
      continue;
    }

    const leaves = await expandRecipeToAtomicLeaves(db, recipe.id, outlet.id);

    // Sum cost across leaves.
    let baseTotal = 0;
    const breakdown: Array<{ name: string; qty: number; costPerUnit: number; lineCost: number }> = [];
    for (const [ingId, qty] of leaves) {
      const [ing] = await db.select({ name: ingredients.name, costPerUnit: ingredients.costPerUnit }).from(ingredients).where(eq(ingredients.id, ingId)).limit(1);
      if (!ing) continue;
      const lineCost = ing.costPerUnit * qty;
      baseTotal += lineCost;
      breakdown.push({ name: ing.name, qty, costPerUnit: ing.costPerUnit, lineCost });
    }

    // Apply menu Q-factor.
    const totalWithQ = Math.round(baseTotal * (1 + recipe.wasteFactorPct / 100));

    const label = `${s.name}${s.variant ? ` (${s.variant})` : ""}`;
    console.log(`=== ${label} ===`);
    for (const b of breakdown) {
      console.log(`  ${b.name.padEnd(28)} ${String(b.qty).padStart(4)} × ${String(b.costPerUnit).padStart(4)} = Rp ${b.lineCost.toLocaleString("id-ID")}`);
    }
    console.log(`  ${"TOTAL (base)".padEnd(28)} → Rp ${baseTotal.toLocaleString("id-ID")}`);
    console.log(`  ${`Q-factor ${recipe.wasteFactorPct}%`.padEnd(28)} → Rp ${totalWithQ.toLocaleString("id-ID")}`);
    console.log(`  Owner display:                  Rp ${s.ownerExpected.toLocaleString("id-ID")}`);
    const delta = Math.abs(totalWithQ - s.ownerExpected);
    const pct = (delta / s.ownerExpected) * 100;
    console.log(`  Delta:                          Rp ${delta.toLocaleString("id-ID")} (${pct.toFixed(1)}%)`);
    console.log(`  ${s.note}\n`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
