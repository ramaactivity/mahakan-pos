import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, menuItems, modifiers } from "@/db/schema";
import type { Category, MenuItem, Modifier, Paginated } from "./types";

export interface ListMenuItemsOptions {
  activeOnly?: boolean;
  categoryId?: string;
  search?: string;
  soldOut?: boolean;
}

export async function fetchMenuItems(
  opts: ListMenuItemsOptions = {},
): Promise<Paginated<MenuItem>> {
  const { activeOnly = true, categoryId, search, soldOut } = opts;

  const conds = [isNull(menuItems.deletedAt)];
  if (activeOnly) conds.push(eq(menuItems.isActive, true));
  if (categoryId) conds.push(eq(menuItems.categoryId, categoryId));
  if (typeof soldOut === "boolean") conds.push(eq(menuItems.isSoldOut, soldOut));
  if (search) {
    const like = `%${search.toLowerCase().trim()}%`;
    conds.push(sql`lower(${menuItems.name}) like ${like}`);
  }

  const rows = await db
    .select()
    .from(menuItems)
    .where(and(...conds))
    .orderBy(menuItems.displayOrder, menuItems.name);

  return { items: rows, total: rows.length };
}

export async function fetchMenuItemById(
  id: string,
): Promise<MenuItem | null> {
  const [row] = await db
    .select()
    .from(menuItems)
    .where(and(eq(menuItems.id, id), isNull(menuItems.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function fetchCategories(): Promise<Paginated<Category>> {
  const rows = await db
    .select()
    .from(categories)
    .where(and(isNull(categories.deletedAt), eq(categories.isActive, true)))
    .orderBy(categories.displayOrder, categories.name);
  return { items: rows, total: rows.length };
}

export async function fetchAllCategories(): Promise<Paginated<Category>> {
  // includes inactive (admin view); filters soft-deleted
  const rows = await db
    .select()
    .from(categories)
    .where(isNull(categories.deletedAt))
    .orderBy(categories.displayOrder, categories.name);
  return { items: rows, total: rows.length };
}

export async function fetchModifiers(): Promise<Paginated<Modifier>> {
  const rows = await db
    .select()
    .from(modifiers)
    .where(eq(modifiers.isActive, true));
  return { items: rows, total: rows.length };
}

/**
 * Modifiers applicable to a category. A modifier with appliesToCategories=null
 * is global; otherwise only applies if categoryId is in its array.
 */
export async function fetchModifiersForCategory(
  categoryId: string,
): Promise<Paginated<Modifier>> {
  const all = await fetchModifiers();
  const items = all.items.filter((m) => {
    if (!m.appliesToCategories || m.appliesToCategories.length === 0)
      return true;
    return m.appliesToCategories.includes(categoryId);
  });
  return { items, total: items.length };
}
