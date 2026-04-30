import "server-only";
import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ingredients,
  inventoryMovements,
  recipeIngredients,
  recipes,
} from "@/db/schema";
import type {
  Ingredient,
  ListMovementsOptions,
  MovementWithIngredient,
  Paginated,
  Recipe,
  RecipeIngredientLine,
  RecipeWithIngredients,
} from "./types";

export interface ListIngredientsOptions {
  activeOnly?: boolean;
  search?: string;
  /** Filter ingredients by their assigned section. "unassigned" matches
   * NULL section. "all" / undefined disables filter. */
  section?: "kitchen" | "bar" | "supporting" | "cleaning" | "unassigned" | "all";
}

export async function fetchIngredients(
  outletId: string,
  opts: ListIngredientsOptions = {},
): Promise<Paginated<Ingredient>> {
  const { activeOnly = true, search } = opts;
  const conds = [
    eq(ingredients.outletId, outletId),
    isNull(ingredients.deletedAt),
  ];
  if (activeOnly) conds.push(eq(ingredients.isActive, true));
  if (search) {
    const like = `%${search.toLowerCase().trim()}%`;
    conds.push(sql`lower(${ingredients.name}) like ${like}`);
  }

  const rows = await db
    .select()
    .from(ingredients)
    .where(and(...conds))
    .orderBy(ingredients.name);

  return { items: rows, total: rows.length };
}

export async function fetchAtomicIngredients(
  outletId: string,
  opts: ListIngredientsOptions = {},
): Promise<Paginated<Ingredient>> {
  const { activeOnly = true, search, section } = opts;
  const conds = [
    eq(ingredients.outletId, outletId),
    isNull(ingredients.deletedAt),
    eq(ingredients.isPreparation, false),
  ];
  if (activeOnly) conds.push(eq(ingredients.isActive, true));
  if (search) {
    const like = `%${search.toLowerCase().trim()}%`;
    conds.push(sql`lower(${ingredients.name}) like ${like}`);
  }
  if (section && section !== "all") {
    if (section === "unassigned") {
      conds.push(isNull(ingredients.section));
    } else {
      conds.push(eq(ingredients.section, section));
    }
  }

  const rows = await db
    .select()
    .from(ingredients)
    .where(and(...conds))
    .orderBy(ingredients.name);

  return { items: rows, total: rows.length };
}

export async function fetchPreparations(
  outletId: string,
  opts: ListIngredientsOptions = {},
): Promise<Paginated<Ingredient>> {
  const { activeOnly = true, search } = opts;
  const conds = [
    eq(ingredients.outletId, outletId),
    isNull(ingredients.deletedAt),
    eq(ingredients.isPreparation, true),
  ];
  if (activeOnly) conds.push(eq(ingredients.isActive, true));
  if (search) {
    const like = `%${search.toLowerCase().trim()}%`;
    conds.push(sql`lower(${ingredients.name}) like ${like}`);
  }

  const rows = await db
    .select()
    .from(ingredients)
    .where(and(...conds))
    .orderBy(ingredients.name);

  return { items: rows, total: rows.length };
}

export async function fetchRecipeForPreparation(
  ingredientId: string,
): Promise<RecipeWithIngredients | null> {
  const [recipe] = await db
    .select()
    .from(recipes)
    .where(
      and(
        eq(recipes.ingredientId, ingredientId),
        eq(recipes.isActive, true),
      ),
    )
    .limit(1);
  if (!recipe) return null;

  const lines = await fetchRecipeIngredientLines(recipe.id);
  return { ...recipe, ingredients: lines };
}

export async function fetchIngredientById(
  id: string,
): Promise<Ingredient | null> {
  const [row] = await db
    .select()
    .from(ingredients)
    .where(and(eq(ingredients.id, id), isNull(ingredients.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function fetchLowStockIngredients(
  outletId: string,
): Promise<Ingredient[]> {
  return db
    .select()
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, outletId),
        eq(ingredients.isActive, true),
        isNull(ingredients.deletedAt),
        sql`${ingredients.reorderThreshold} IS NOT NULL`,
        sql`${ingredients.currentStock} < ${ingredients.reorderThreshold}`,
      ),
    )
    .orderBy(ingredients.name);
}

export async function fetchMovements(
  outletId: string,
  opts: ListMovementsOptions = {},
): Promise<Paginated<MovementWithIngredient>> {
  // Cap upper bound at 5000 to support CSV export while preventing accidental
  // megabyte responses. Paginated viewer never exceeds PAGE_SIZE=50.
  const limit = Math.min(opts.limit ?? 100, 5000);
  const offset = opts.offset ?? 0;

  const conds = [eq(inventoryMovements.outletId, outletId)];
  if (opts.ingredientId)
    conds.push(eq(inventoryMovements.ingredientId, opts.ingredientId));
  if (opts.kind) conds.push(eq(inventoryMovements.kind, opts.kind));
  if (opts.dateFrom)
    conds.push(gte(inventoryMovements.createdAt, opts.dateFrom));
  if (opts.dateTo) conds.push(lt(inventoryMovements.createdAt, opts.dateTo));

  const rows = await db
    .select({
      movement: inventoryMovements,
      ingredient: {
        id: ingredients.id,
        name: ingredients.name,
        unit: ingredients.unit,
      },
    })
    .from(inventoryMovements)
    .innerJoin(
      ingredients,
      eq(ingredients.id, inventoryMovements.ingredientId),
    )
    .where(and(...conds))
    .orderBy(desc(inventoryMovements.createdAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  const items: MovementWithIngredient[] = sliced.map((r) => ({
    ...r.movement,
    ingredient: r.ingredient,
  }));

  return { items, total: items.length, hasMore };
}

// ---------- Recipes ----------

export async function fetchRecipeById(
  id: string,
): Promise<RecipeWithIngredients | null> {
  const [recipe] = await db
    .select()
    .from(recipes)
    .where(eq(recipes.id, id))
    .limit(1);
  if (!recipe) return null;

  const lines = await fetchRecipeIngredientLines(id);
  return { ...recipe, ingredients: lines };
}

export async function fetchRecipesForMenuItem(
  menuItemId: string,
): Promise<RecipeWithIngredients[]> {
  const recipeRows = await db
    .select()
    .from(recipes)
    .where(eq(recipes.menuItemId, menuItemId))
    .orderBy(asc(recipes.variant));

  if (recipeRows.length === 0) return [];

  const allLines = await db
    .select({
      ri: recipeIngredients,
      ingredient: {
        id: ingredients.id,
        name: ingredients.name,
        unit: ingredients.unit,
        costPerUnit: ingredients.costPerUnit,
      },
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredientId))
    .where(
      sql`${recipeIngredients.recipeId} IN ${recipeRows.map((r) => r.id)}`,
    );

  const linesByRecipe = new Map<string, RecipeIngredientLine[]>();
  for (const row of allLines) {
    const list = linesByRecipe.get(row.ri.recipeId) ?? [];
    list.push({ ...row.ri, ingredient: row.ingredient });
    linesByRecipe.set(row.ri.recipeId, list);
  }

  return recipeRows.map((r) => ({
    ...r,
    ingredients: linesByRecipe.get(r.id) ?? [],
  }));
}

export async function fetchAllRecipes(
  outletId: string,
): Promise<Recipe[]> {
  return db
    .select()
    .from(recipes)
    .where(eq(recipes.outletId, outletId))
    .orderBy(desc(recipes.createdAt));
}

async function fetchRecipeIngredientLines(
  recipeId: string,
): Promise<RecipeIngredientLine[]> {
  const rows = await db
    .select({
      ri: recipeIngredients,
      ingredient: {
        id: ingredients.id,
        name: ingredients.name,
        unit: ingredients.unit,
        costPerUnit: ingredients.costPerUnit,
      },
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredientId))
    .where(eq(recipeIngredients.recipeId, recipeId));

  return rows.map((r) => ({ ...r.ri, ingredient: r.ingredient }));
}
