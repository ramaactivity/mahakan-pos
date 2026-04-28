/**
 * `npm run inventory:export` — dumps current DB state ke 5 CSV file di
 * `data/exports/<YYYYMMDD-HHmmss>/`. Format kompatibel dengan importer.
 *
 * Use case:
 *   - Owner mau update price massal: export → edit di Excel → re-import
 *   - Backup snapshot sebelum cascade besar
 *
 * Single-outlet auto-detect; pakai --outlet untuk multi-outlet override.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  ingredients,
  menuItems,
  recipeIngredients,
  recipes,
} from "@/db/schema";
import { writeCsv } from "./_shared/csv-io";
import { getString, parseCliArgs } from "./_shared/cli-args";

const EXPORT_ROOT = resolve(process.cwd(), "data/exports");

function timestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function main() {
  const args = parseCliArgs();
  const outletOverride = getString(args, "outlet");

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not set in .env.local");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  try {
    // Outlet resolution (inline — script-local pool doesn't share with shared resolver).
    let outletId: string;
    if (outletOverride) {
      outletId = outletOverride;
    } else {
      // Use the outletId from the first ingredient row, OR query outlets table directly.
      // For simplicity, query the actual outlets table.
      const outletRows = await pool.query<{ id: string; name: string }>(
        `SELECT id, name FROM outlets WHERE deleted_at IS NULL`,
      );
      if (outletRows.rows.length === 0) {
        throw new Error("Tidak ada outlet di DB. Jalankan `npm run db:seed` dulu.");
      }
      if (outletRows.rows.length > 1) {
        const list = outletRows.rows
          .map((r) => `  - ${r.id}  ${r.name}`)
          .join("\n");
        throw new Error(
          `Multiple outlets ditemukan, pakai flag --outlet <uuid>:\n${list}`,
        );
      }
      outletId = outletRows.rows[0].id;
    }

    const outDir = resolve(EXPORT_ROOT, timestamp());
    if (existsSync(outDir)) {
      throw new Error(`Output dir already exists: ${outDir} (race?)`);
    }
    mkdirSync(outDir, { recursive: true });

    console.log(`Exporting outlet ${outletId} ke ${outDir}…\n`);

    // ----- 01 ingredients -----
    const atomicRows = await db
      .select({
        name: ingredients.name,
        unit: ingredients.unit,
        cost_per_unit: ingredients.costPerUnit,
        initial_stock: ingredients.currentStock,
        reorder_threshold: ingredients.reorderThreshold,
        notes: ingredients.notes,
      })
      .from(ingredients)
      .where(
        and(
          eq(ingredients.outletId, outletId),
          isNull(ingredients.deletedAt),
          eq(ingredients.isPreparation, false),
        ),
      )
      .orderBy(asc(ingredients.name));

    writeCsv(
      resolve(outDir, "01-ingredients.csv"),
      atomicRows.map((r) => ({
        name: r.name,
        unit: r.unit,
        cost_per_unit: String(r.cost_per_unit),
        initial_stock: String(r.initial_stock),
        reorder_threshold: r.reorder_threshold == null ? "" : String(r.reorder_threshold),
        notes: r.notes ?? "",
      })),
      {
        headers: ["name", "unit", "cost_per_unit", "initial_stock", "reorder_threshold", "notes"],
      },
    );
    console.log(`  [WRITTEN] 01-ingredients.csv          ${atomicRows.length} rows`);

    // ----- 02 preparations -----
    const prepRows = await db
      .select({
        id: ingredients.id,
        name: ingredients.name,
        unit: ingredients.unit,
        yield_units: ingredients.preparationYield,
        notes: ingredients.notes,
      })
      .from(ingredients)
      .where(
        and(
          eq(ingredients.outletId, outletId),
          isNull(ingredients.deletedAt),
          eq(ingredients.isPreparation, true),
        ),
      )
      .orderBy(asc(ingredients.name));

    // Need waste_factor_pct from recipes targeting each prep. Lookup all in 1 query.
    const prepIds = prepRows.map((p) => p.id);
    const prepRecipeRows = prepIds.length > 0
      ? await db
          .select({
            id: recipes.id,
            ingredient_id: recipes.ingredientId,
            waste_factor_pct: recipes.wasteFactorPct,
          })
          .from(recipes)
          .where(
            and(
              inArray(recipes.ingredientId, prepIds),
              eq(recipes.outletId, outletId),
              eq(recipes.isActive, true),
            ),
          )
      : [];
    const wasteByPrepId = new Map<string, number>();
    const recipeIdByPrepId = new Map<string, string>();
    for (const r of prepRecipeRows) {
      if (r.ingredient_id) {
        wasteByPrepId.set(r.ingredient_id, r.waste_factor_pct);
        recipeIdByPrepId.set(r.ingredient_id, r.id);
      }
    }

    writeCsv(
      resolve(outDir, "02-preparations.csv"),
      prepRows.map((r) => ({
        name: r.name,
        unit: r.unit,
        yield: r.yield_units == null ? "" : String(r.yield_units),
        waste_factor_pct: String(wasteByPrepId.get(r.id) ?? 10),
        notes: r.notes ?? "",
      })),
      {
        headers: ["name", "unit", "yield", "waste_factor_pct", "notes"],
      },
    );
    console.log(`  [WRITTEN] 02-preparations.csv         ${prepRows.length} rows`);

    // ----- 03 preparation lines -----
    const prepRecipeIds = Array.from(recipeIdByPrepId.values());
    const prepLineRows = prepRecipeIds.length > 0
      ? await db
          .select({
            recipe_id: recipeIngredients.recipeId,
            ingredient_id: recipeIngredients.ingredientId,
            qty: recipeIngredients.qty,
          })
          .from(recipeIngredients)
          .where(inArray(recipeIngredients.recipeId, prepRecipeIds))
      : [];

    // Build ingredient name lookup (atomic + prep).
    const allIngsForLookup = await db
      .select({ id: ingredients.id, name: ingredients.name })
      .from(ingredients)
      .where(
        and(
          eq(ingredients.outletId, outletId),
          isNull(ingredients.deletedAt),
        ),
      );
    const nameByIngId = new Map(allIngsForLookup.map((r) => [r.id, r.name]));
    const recipeIdToPrepName = new Map<string, string>();
    for (const [prepId, recipeId] of recipeIdByPrepId) {
      const prepName = prepRows.find((p) => p.id === prepId)?.name;
      if (prepName) recipeIdToPrepName.set(recipeId, prepName);
    }

    writeCsv(
      resolve(outDir, "03-preparation-lines.csv"),
      prepLineRows
        .map((l) => ({
          prep_name: recipeIdToPrepName.get(l.recipe_id) ?? "",
          ingredient_name: nameByIngId.get(l.ingredient_id) ?? "",
          qty: String(l.qty),
        }))
        .filter((r) => r.prep_name && r.ingredient_name)
        .sort((a, b) => a.prep_name.localeCompare(b.prep_name) || a.ingredient_name.localeCompare(b.ingredient_name)),
      {
        headers: ["prep_name", "ingredient_name", "qty"],
      },
    );
    console.log(`  [WRITTEN] 03-preparation-lines.csv    ${prepLineRows.length} rows`);

    // ----- 04 menu recipes -----
    const menuRecipeRows = await db
      .select({
        recipe_id: recipes.id,
        menu_item_id: recipes.menuItemId,
        variant: recipes.variant,
        waste_factor_pct: recipes.wasteFactorPct,
        notes: recipes.notes,
      })
      .from(recipes)
      .where(
        and(
          eq(recipes.outletId, outletId),
          eq(recipes.isActive, true),
          isNotNull(recipes.menuItemId),
        ),
      );

    // Resolve menu_item_id → name.
    const menuIds = Array.from(
      new Set(menuRecipeRows.map((r) => r.menu_item_id).filter((id): id is string => id !== null)),
    );
    const menuNameById = new Map<string, string>();
    if (menuIds.length > 0) {
      const menuRows = await db
        .select({ id: menuItems.id, name: menuItems.name })
        .from(menuItems)
        .where(inArray(menuItems.id, menuIds));
      for (const m of menuRows) menuNameById.set(m.id, m.name);
    }

    writeCsv(
      resolve(outDir, "04-menu-recipes.csv"),
      menuRecipeRows
        .map((r) => ({
          menu_name: r.menu_item_id ? menuNameById.get(r.menu_item_id) ?? "" : "",
          variant: r.variant ?? "",
          waste_factor_pct: String(r.waste_factor_pct),
          notes: r.notes ?? "",
        }))
        .filter((r) => r.menu_name)
        .sort((a, b) => a.menu_name.localeCompare(b.menu_name) || a.variant.localeCompare(b.variant)),
      {
        headers: ["menu_name", "variant", "waste_factor_pct", "notes"],
      },
    );
    console.log(`  [WRITTEN] 04-menu-recipes.csv         ${menuRecipeRows.length} rows`);

    // ----- 05 menu recipe lines -----
    const menuRecipeIds = menuRecipeRows.map((r) => r.recipe_id);
    const menuLineRows = menuRecipeIds.length > 0
      ? await db
          .select({
            recipe_id: recipeIngredients.recipeId,
            ingredient_id: recipeIngredients.ingredientId,
            qty: recipeIngredients.qty,
          })
          .from(recipeIngredients)
          .where(inArray(recipeIngredients.recipeId, menuRecipeIds))
      : [];

    const recipeIdToMenu = new Map<string, { name: string; variant: string }>();
    for (const r of menuRecipeRows) {
      const name = r.menu_item_id ? menuNameById.get(r.menu_item_id) : null;
      if (name) {
        recipeIdToMenu.set(r.recipe_id, { name, variant: r.variant ?? "" });
      }
    }

    writeCsv(
      resolve(outDir, "05-menu-recipe-lines.csv"),
      menuLineRows
        .map((l) => {
          const menu = recipeIdToMenu.get(l.recipe_id);
          if (!menu) return null;
          return {
            menu_name: menu.name,
            variant: menu.variant,
            ingredient_name: nameByIngId.get(l.ingredient_id) ?? "",
            qty: String(l.qty),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null && r.ingredient_name !== "")
        .sort(
          (a, b) =>
            a.menu_name.localeCompare(b.menu_name) ||
            a.variant.localeCompare(b.variant) ||
            a.ingredient_name.localeCompare(b.ingredient_name),
        ),
      {
        headers: ["menu_name", "variant", "ingredient_name", "qty"],
      },
    );
    console.log(`  [WRITTEN] 05-menu-recipe-lines.csv    ${menuLineRows.length} rows`);

    console.log(`\nDone. Export di: ${outDir}`);
    console.log(`\nNext: edit hasil → re-import via:`);
    console.log(`  npm run inventory:import -- --source ${outDir}`);
    console.log(`  npm run inventory:import -- --source ${outDir} --apply`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
