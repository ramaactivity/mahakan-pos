import "server-only";
import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { ingredients, inventoryMovements } from "@/db/schema";
import type {
  Ingredient,
  ListMovementsOptions,
  MovementWithIngredient,
  Paginated,
} from "./types";

export interface ListIngredientsOptions {
  activeOnly?: boolean;
  search?: string;
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
  const limit = opts.limit ?? 100;
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

