import { mockCategories, mockMenuItems, mockModifiers } from "../data";
import type {
  ApiResult,
  Category,
  MenuItem,
  Modifier,
  Paginated,
} from "../types";
import { delay, fail, ok } from "./_helpers";

// Mutable working copies — mocks only; Fase B replaces with DB queries.
let categories: Category[] = mockCategories.map((c) => ({ ...c }));
let menuItems: MenuItem[] = mockMenuItems.map((i) => ({ ...i }));
const modifiers: Modifier[] = mockModifiers.map((m) => ({ ...m }));

export interface ListMenuItemsOptions {
  activeOnly?: boolean;
  categoryId?: string;
  search?: string;
  soldOut?: boolean;
}

export async function listMenuItems(
  options: ListMenuItemsOptions = {},
): Promise<ApiResult<Paginated<MenuItem>>> {
  await delay();

  const { activeOnly = true, categoryId, search, soldOut } = options;
  const searchLower = search?.toLowerCase().trim();

  const filtered = menuItems.filter((item) => {
    if (item.deletedAt !== null) return false;
    if (activeOnly && !item.isActive) return false;
    if (categoryId && item.categoryId !== categoryId) return false;
    if (soldOut !== undefined && item.isSoldOut !== soldOut) return false;
    if (searchLower && !item.name.toLowerCase().includes(searchLower)) return false;
    return true;
  });

  filtered.sort((a, b) => a.displayOrder - b.displayOrder);

  return ok({
    items: filtered,
    total: filtered.length,
  });
}

export async function getMenuItem(id: string): Promise<ApiResult<MenuItem>> {
  await delay();
  const found = menuItems.find((i) => i.id === id && i.deletedAt === null);
  if (!found) return fail("NOT_FOUND", "Menu item tidak ditemukan");
  return ok({ ...found });
}

export async function toggleSoldOut(
  id: string,
  isSoldOut: boolean,
): Promise<ApiResult<MenuItem>> {
  await delay();
  const index = menuItems.findIndex((i) => i.id === id && i.deletedAt === null);
  if (index === -1) return fail("NOT_FOUND", "Menu item tidak ditemukan");
  menuItems[index] = {
    ...menuItems[index],
    isSoldOut,
    updatedAt: new Date().toISOString(),
  };
  return ok({ ...menuItems[index] });
}

export async function listCategories(): Promise<ApiResult<Paginated<Category>>> {
  await delay();
  const active = categories.filter((c) => c.isActive && c.deletedAt === null);
  active.sort((a, b) => a.displayOrder - b.displayOrder);
  return ok({ items: active, total: active.length });
}

export async function listModifiers(): Promise<ApiResult<Paginated<Modifier>>> {
  await delay();
  const active = modifiers.filter((m) => m.isActive);
  return ok({ items: active, total: active.length });
}

/** Return modifiers applicable to a given category (plus global ones). */
export async function listModifiersForCategory(
  categoryId: string,
): Promise<ApiResult<Paginated<Modifier>>> {
  await delay();
  const applicable = modifiers.filter((m) => {
    if (!m.isActive) return false;
    if (m.appliesToCategories === null) return true; // all categories
    return m.appliesToCategories.includes(categoryId);
  });
  return ok({ items: applicable, total: applicable.length });
}

/** Test-only helper to reset state between stories/tests. */
export function __resetMenuState(): void {
  categories = mockCategories.map((c) => ({ ...c }));
  menuItems = mockMenuItems.map((i) => ({ ...i }));
}
