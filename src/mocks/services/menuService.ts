import { OUTLET_ID, mockCategories, mockMenuItems, mockModifiers } from "../data";
import type {
  ApiResult,
  Category,
  MenuItem,
  Modifier,
  Paginated,
  PriceType,
} from "../types";
import { isValidPriceRange } from "@/lib/money";
import { delay, fail, genId, ok } from "./_helpers";

// Mutable working copies — mocks only; Fase B replaces with DB queries.
let categories: Category[] = mockCategories.map((c) => ({ ...c }));
let menuItems: MenuItem[] = mockMenuItems.map((i) => ({ ...i }));
let modifiers: Modifier[] = mockModifiers.map((m) => ({ ...m }));

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

// --------------------------------------------------------------------------
// Menu Item CRUD
// --------------------------------------------------------------------------

export interface MenuItemUpsertInput {
  name: string;
  description: string | null;
  categoryId: string;
  priceType: PriceType;
  priceFixed: number | null;
  priceHot: number | null;
  priceIced: number | null;
  isSignature: boolean;
  displayOrder: number;
}

function validateMenuItemInput(
  input: MenuItemUpsertInput,
): { ok: true } | { ok: false; code: string; message: string; field?: string } {
  if (input.name.trim().length === 0) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Nama wajib diisi", field: "name" };
  }
  if (!categories.some((c) => c.id === input.categoryId && c.deletedAt === null)) {
    return { ok: false, code: "CATEGORY_NOT_FOUND", message: "Kategori tidak valid", field: "categoryId" };
  }
  switch (input.priceType) {
    case "fixed":
      if (input.priceFixed === null) {
        return { ok: false, code: "MENU_NO_PRICE", message: "Harga fixed wajib diisi", field: "priceFixed" };
      }
      if (!isValidPriceRange(input.priceFixed)) {
        return { ok: false, code: "MENU_INVALID_PRICE", message: "Harga di luar range valid", field: "priceFixed" };
      }
      if (input.priceHot !== null || input.priceIced !== null) {
        return { ok: false, code: "VALIDATION_ERROR", message: "Fixed item tidak boleh punya price hot/iced" };
      }
      break;
    case "variant":
      if (input.priceHot === null && input.priceIced === null) {
        return { ok: false, code: "MENU_NO_PRICE", message: "Variant butuh minimal 1 harga (hot atau iced)" };
      }
      if (input.priceHot !== null && !isValidPriceRange(input.priceHot)) {
        return { ok: false, code: "MENU_INVALID_PRICE", message: "Harga hot di luar range", field: "priceHot" };
      }
      if (input.priceIced !== null && !isValidPriceRange(input.priceIced)) {
        return { ok: false, code: "MENU_INVALID_PRICE", message: "Harga iced di luar range", field: "priceIced" };
      }
      if (input.priceFixed !== null) {
        return { ok: false, code: "VALIDATION_ERROR", message: "Variant item tidak boleh punya price fixed" };
      }
      break;
    case "open":
      if (input.priceFixed !== null || input.priceHot !== null || input.priceIced !== null) {
        return { ok: false, code: "VALIDATION_ERROR", message: "Open-price item tidak boleh punya price preset" };
      }
      break;
  }
  return { ok: true };
}

export async function createMenuItem(
  input: MenuItemUpsertInput,
): Promise<ApiResult<MenuItem>> {
  await delay();
  const v = validateMenuItemInput(input);
  if (!v.ok) return fail(v.code, v.message, v.field);

  // Unique name per category
  const dup = menuItems.find(
    (i) =>
      i.categoryId === input.categoryId &&
      i.deletedAt === null &&
      i.name.toLowerCase() === input.name.trim().toLowerCase(),
  );
  if (dup) {
    return fail(
      "MENU_NAME_DUPLICATE",
      `Item "${input.name}" sudah ada di kategori ini`,
      "name",
    );
  }

  const now = new Date().toISOString();
  const item: MenuItem = {
    id: genId("item"),
    outletId: OUTLET_ID,
    categoryId: input.categoryId,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    priceType: input.priceType,
    priceFixed: input.priceFixed,
    priceHot: input.priceHot,
    priceIced: input.priceIced,
    isSignature: input.isSignature,
    isSoldOut: false,
    isActive: true,
    displayOrder: input.displayOrder,
    costPrice: null,
    recipeId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  menuItems = [...menuItems, item];
  return ok({ ...item });
}

export async function updateMenuItem(
  id: string,
  input: MenuItemUpsertInput,
): Promise<ApiResult<MenuItem>> {
  await delay();
  const idx = menuItems.findIndex((i) => i.id === id && i.deletedAt === null);
  if (idx === -1) return fail("NOT_FOUND", "Menu item tidak ditemukan");
  const v = validateMenuItemInput(input);
  if (!v.ok) return fail(v.code, v.message, v.field);

  const dup = menuItems.find(
    (i) =>
      i.id !== id &&
      i.categoryId === input.categoryId &&
      i.deletedAt === null &&
      i.name.toLowerCase() === input.name.trim().toLowerCase(),
  );
  if (dup) {
    return fail("MENU_NAME_DUPLICATE", "Nama sudah dipakai item lain", "name");
  }

  menuItems[idx] = {
    ...menuItems[idx],
    name: input.name.trim(),
    description: input.description?.trim() || null,
    categoryId: input.categoryId,
    priceType: input.priceType,
    priceFixed: input.priceFixed,
    priceHot: input.priceHot,
    priceIced: input.priceIced,
    isSignature: input.isSignature,
    displayOrder: input.displayOrder,
    updatedAt: new Date().toISOString(),
  };
  return ok({ ...menuItems[idx] });
}

export async function deleteMenuItem(id: string): Promise<ApiResult<{ id: string }>> {
  await delay();
  const idx = menuItems.findIndex((i) => i.id === id && i.deletedAt === null);
  if (idx === -1) return fail("NOT_FOUND", "Menu item tidak ditemukan");
  const now = new Date().toISOString();
  menuItems[idx] = { ...menuItems[idx], deletedAt: now, updatedAt: now };
  return ok({ id });
}

// --------------------------------------------------------------------------
// Category CRUD
// --------------------------------------------------------------------------

export async function createCategory(
  name: string,
): Promise<ApiResult<Category>> {
  await delay();
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return fail("VALIDATION_ERROR", "Nama kategori wajib diisi", "name");
  }
  if (
    categories.some(
      (c) =>
        c.deletedAt === null &&
        c.name.toLowerCase() === trimmed.toLowerCase(),
    )
  ) {
    return fail("CATEGORY_NAME_DUPLICATE", "Kategori sudah ada", "name");
  }
  const maxOrder = categories.reduce(
    (m, c) => Math.max(m, c.displayOrder),
    0,
  );
  const now = new Date().toISOString();
  const cat: Category = {
    id: genId("cat"),
    outletId: OUTLET_ID,
    name: trimmed,
    displayOrder: maxOrder + 1,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  categories = [...categories, cat];
  return ok({ ...cat });
}

export async function updateCategory(
  id: string,
  patch: { name?: string; displayOrder?: number },
): Promise<ApiResult<Category>> {
  await delay();
  const idx = categories.findIndex(
    (c) => c.id === id && c.deletedAt === null,
  );
  if (idx === -1) return fail("NOT_FOUND", "Kategori tidak ditemukan");

  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (trimmed.length === 0) {
      return fail("VALIDATION_ERROR", "Nama kategori wajib diisi", "name");
    }
    if (
      categories.some(
        (c) =>
          c.id !== id &&
          c.deletedAt === null &&
          c.name.toLowerCase() === trimmed.toLowerCase(),
      )
    ) {
      return fail("CATEGORY_NAME_DUPLICATE", "Kategori sudah ada", "name");
    }
  }

  categories[idx] = {
    ...categories[idx],
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.displayOrder !== undefined
      ? { displayOrder: patch.displayOrder }
      : {}),
    updatedAt: new Date().toISOString(),
  };
  return ok({ ...categories[idx] });
}

export async function deleteCategory(
  id: string,
): Promise<ApiResult<{ id: string }>> {
  await delay();
  const idx = categories.findIndex(
    (c) => c.id === id && c.deletedAt === null,
  );
  if (idx === -1) return fail("NOT_FOUND", "Kategori tidak ditemukan");

  // Block delete if items still reference this category
  const itemCount = menuItems.filter(
    (i) => i.categoryId === id && i.deletedAt === null,
  ).length;
  if (itemCount > 0) {
    return fail(
      "BUSINESS_RULE_VIOLATION",
      `Masih ada ${itemCount} item di kategori ini. Hapus / pindah dulu.`,
    );
  }

  const now = new Date().toISOString();
  categories[idx] = { ...categories[idx], deletedAt: now, updatedAt: now };
  return ok({ id });
}

export async function reorderCategory(
  id: string,
  direction: "up" | "down",
): Promise<ApiResult<Category[]>> {
  await delay();
  const sorted = categories
    .filter((c) => c.deletedAt === null)
    .sort((a, b) => a.displayOrder - b.displayOrder);
  const idx = sorted.findIndex((c) => c.id === id);
  if (idx === -1) return fail("NOT_FOUND", "Kategori tidak ditemukan");
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= sorted.length) {
    return fail("BUSINESS_RULE_VIOLATION", "Sudah di posisi paling ujung");
  }
  const a = sorted[idx];
  const b = sorted[swapWith];
  const aOrder = a.displayOrder;
  const bOrder = b.displayOrder;
  const now = new Date().toISOString();
  categories = categories.map((c) => {
    if (c.id === a.id) return { ...c, displayOrder: bOrder, updatedAt: now };
    if (c.id === b.id) return { ...c, displayOrder: aOrder, updatedAt: now };
    return c;
  });
  return ok([...categories].sort((x, y) => x.displayOrder - y.displayOrder));
}

// --------------------------------------------------------------------------
// Modifier price update (only extra_shot + extra_topping_ayam editable)
// --------------------------------------------------------------------------

const EDITABLE_MODIFIER_SLUGS = new Set(["extra_shot", "extra_topping_ayam"]);

export async function updateModifierPrice(
  slug: string,
  price: number,
): Promise<ApiResult<Modifier>> {
  await delay();
  if (!EDITABLE_MODIFIER_SLUGS.has(slug)) {
    return fail(
      "BUSINESS_RULE_VIOLATION",
      `Modifier "${slug}" tidak bisa di-edit harganya`,
    );
  }
  if (!isValidPriceRange(price)) {
    return fail("MENU_INVALID_PRICE", "Harga di luar range", "price");
  }
  const idx = modifiers.findIndex((m) => m.slug === slug);
  if (idx === -1) return fail("NOT_FOUND", "Modifier tidak ditemukan");
  modifiers[idx] = {
    ...modifiers[idx],
    price,
    updatedAt: new Date().toISOString(),
  };
  return ok({ ...modifiers[idx] });
}

/** Test-only helper to reset state between stories/tests. */
export function __resetMenuState(): void {
  categories = mockCategories.map((c) => ({ ...c }));
  menuItems = mockMenuItems.map((i) => ({ ...i }));
  modifiers = mockModifiers.map((m) => ({ ...m }));
}
