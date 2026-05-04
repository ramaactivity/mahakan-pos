"use server";

import { and, eq, isNull, gt, lt, asc, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, menuItems, modifiers } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { diffShallow, logAudit } from "@/lib/audit/logger";
import {
  fetchAllCategories,
  fetchCategories,
  fetchMenuItemById,
  fetchMenuItems,
  fetchModifiers,
  fetchModifiersForCategory,
  type ListMenuItemsOptions,
} from "./queries";
import { fetchRecipesForMenuItem } from "@/features/inventory/queries";
import { expandRecipeToAtomicLeaves } from "@/features/inventory/preparation-flow";
import { ingredients, outlets } from "@/db/schema";
import { inArray } from "drizzle-orm";
import {
  categoryNameSchema,
  createMenuItemSchema,
  reorderDirSchema,
  updateMenuItemSchema,
  type CreateMenuItemInput,
  type UpdateMenuItemInput,
} from "./schemas";
import {
  fail,
  ok,
  type ApiResult,
  type Category,
  type MenuItem,
  type Modifier,
  type Paginated,
} from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

async function requireOwnerOrManager(perm: Parameters<typeof hasPermission>[1]) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, perm)) {
    throw new Error("FORBIDDEN");
  }
  return session;
}

// ---------- Reads ----------

export async function listMenuItems(
  opts: ListMenuItemsOptions = {},
): Promise<ApiResult<Paginated<MenuItem>>> {
  const result = await fetchMenuItems(opts);
  return ok(result);
}

export async function getMenuItem(id: string): Promise<ApiResult<MenuItem>> {
  const row = await fetchMenuItemById(id);
  if (!row) return fail("NOT_FOUND", "Menu item tidak ditemukan");
  return ok(row);
}

export async function listCategories(): Promise<ApiResult<Paginated<Category>>> {
  return ok(await fetchCategories());
}

export async function listAllCategories(): Promise<
  ApiResult<Paginated<Category>>
> {
  return ok(await fetchAllCategories());
}

export async function listModifiers(): Promise<ApiResult<Paginated<Modifier>>> {
  return ok(await fetchModifiers());
}

export async function listModifiersForCategory(
  categoryId: string,
): Promise<ApiResult<Paginated<Modifier>>> {
  return ok(await fetchModifiersForCategory(categoryId));
}

// ---------- Mutations: menu items ----------

export async function createMenuItem(
  input: CreateMenuItemInput,
): Promise<ApiResult<MenuItem>> {
  const session = await requireOwnerOrManager("menu.item.create");

  const parsed = createMenuItemSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION", parsed.error.issues[0]?.message ?? "Input tidak valid");
  }
  const v = parsed.data;

  const [row] = await db
    .insert(menuItems)
    .values({
      outletId: session.user.outletId,
      categoryId: v.categoryId,
      name: v.name,
      description: v.description ?? null,
      priceType: v.priceType,
      priceFixed: v.priceType === "fixed" ? v.priceFixed : null,
      priceHot: v.priceType === "variant" ? v.priceHot : null,
      priceIced: v.priceType === "variant" ? v.priceIced : null,
      isSignature: v.isSignature ?? false,
      displayOrder: v.displayOrder ?? 999,
      createdBy: session.user.id,
    })
    .returning();

  await logAudit({
    eventType: "menu.item.create",
    userId: session.user.id,
    entityType: "menu_item",
    entityId: row.id,
    payload: {
      summary: `Tambah menu ${row.name}`,
      after: {
        name: row.name,
        priceType: row.priceType,
        priceFixed: row.priceFixed,
        priceHot: row.priceHot,
        priceIced: row.priceIced,
      },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok(row);
}

export async function updateMenuItem(
  id: string,
  input: UpdateMenuItemInput,
): Promise<ApiResult<MenuItem>> {
  const session = await requireOwnerOrManager("menu.item.update");

  const parsed = updateMenuItemSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION", parsed.error.issues[0]?.message ?? "Input tidak valid");
  }
  const v = parsed.data;

  const before = await fetchMenuItemById(id);
  if (!before) return fail("NOT_FOUND", "Menu item tidak ditemukan");

  const [row] = await db
    .update(menuItems)
    .set({
      categoryId: v.categoryId,
      name: v.name,
      description: v.description ?? null,
      priceType: v.priceType,
      priceFixed: v.priceType === "fixed" ? v.priceFixed : null,
      priceHot: v.priceType === "variant" ? v.priceHot : null,
      priceIced: v.priceType === "variant" ? v.priceIced : null,
      isSignature: v.isSignature ?? false,
      displayOrder: v.displayOrder ?? 999,
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(and(eq(menuItems.id, id), isNull(menuItems.deletedAt)))
    .returning();

  if (!row) return fail("NOT_FOUND", "Menu item tidak ditemukan");

  const beforeSnap = {
    name: before.name,
    priceFixed: before.priceFixed,
    priceHot: before.priceHot,
    priceIced: before.priceIced,
    priceType: before.priceType,
  };
  const afterSnap = {
    name: row.name,
    priceFixed: row.priceFixed,
    priceHot: row.priceHot,
    priceIced: row.priceIced,
    priceType: row.priceType,
  };
  const diff = diffShallow(beforeSnap, afterSnap);
  if (diff) {
    await logAudit({
      eventType: "menu.item.update",
      userId: session.user.id,
      entityType: "menu_item",
      entityId: row.id,
      payload: {
        summary: `Update menu ${row.name}${diff.priceFixed || diff.priceHot || diff.priceIced ? " (harga berubah)" : ""}`,
        before: beforeSnap,
        after: afterSnap,
        diff,
      },
      metadata: { outletId: session.user.outletId, actorRole: session.user.role },
    });
  }

  return ok(row);
}

export async function deleteMenuItem(
  id: string,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireOwnerOrManager("menu.item.delete");

  const before = await fetchMenuItemById(id);

  const [row] = await db
    .update(menuItems)
    .set({
      deletedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(and(eq(menuItems.id, id), isNull(menuItems.deletedAt)))
    .returning({ id: menuItems.id });

  if (!row) return fail("NOT_FOUND", "Menu item tidak ditemukan");

  await logAudit({
    eventType: "menu.item.delete",
    userId: session.user.id,
    entityType: "menu_item",
    entityId: row.id,
    payload: {
      summary: `Hapus menu ${before?.name ?? id}`,
      before: before ? { name: before.name } : undefined,
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok({ id: row.id });
}

export async function toggleSoldOut(
  id: string,
  isSoldOut: boolean,
): Promise<ApiResult<MenuItem>> {
  const session = await requireSession();
  const perm = isSoldOut ? "pos.menu.mark_sold_out" : "pos.menu.mark_available";
  if (!hasPermission(session.user.role, perm)) {
    return fail("FORBIDDEN", `Role ${session.user.role} tidak bisa ${perm}`);
  }

  const [row] = await db
    .update(menuItems)
    .set({ isSoldOut, updatedAt: new Date(), updatedBy: session.user.id })
    .where(and(eq(menuItems.id, id), isNull(menuItems.deletedAt)))
    .returning();

  if (!row) return fail("NOT_FOUND", "Menu item tidak ditemukan");

  await logAudit({
    eventType: "menu.item.sold_out_toggle",
    userId: session.user.id,
    entityType: "menu_item",
    entityId: row.id,
    payload: {
      summary: `${isSoldOut ? "Habis" : "Tersedia"}: ${row.name}`,
      context: { isSoldOut },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok(row);
}

// ---------- Mutations: categories ----------

export async function createCategory(
  name: string,
): Promise<ApiResult<Category>> {
  const session = await requireOwnerOrManager("menu.category.crud");

  const parsed = categoryNameSchema.safeParse(name);
  if (!parsed.success) {
    return fail("VALIDATION", parsed.error.issues[0]?.message ?? "Nama tidak valid");
  }

  const [{ maxOrder }] = await db
    .select({ maxOrder: sql<number>`coalesce(max(${categories.displayOrder}), 0)::int` })
    .from(categories)
    .where(eq(categories.outletId, session.user.outletId));

  const [row] = await db
    .insert(categories)
    .values({
      outletId: session.user.outletId,
      name: parsed.data,
      displayOrder: maxOrder + 1,
      createdBy: session.user.id,
    })
    .returning();

  await logAudit({
    eventType: "menu.category.create",
    userId: session.user.id,
    entityType: "category",
    entityId: row.id,
    payload: { summary: `Tambah kategori "${row.name}"`, after: { name: row.name } },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok(row);
}

export async function updateCategory(
  id: string,
  patch: { name?: string },
): Promise<ApiResult<Category>> {
  const session = await requireOwnerOrManager("menu.category.crud");

  const [before] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
    .limit(1);
  if (!before) return fail("NOT_FOUND", "Kategori tidak ditemukan");

  const updates: Partial<typeof categories.$inferInsert> = {
    updatedAt: new Date(),
    updatedBy: session.user.id,
  };
  if (patch.name !== undefined) {
    const parsed = categoryNameSchema.safeParse(patch.name);
    if (!parsed.success) {
      return fail("VALIDATION", parsed.error.issues[0]?.message ?? "Nama tidak valid");
    }
    updates.name = parsed.data;
  }

  const [row] = await db
    .update(categories)
    .set(updates)
    .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
    .returning();

  if (!row) return fail("NOT_FOUND", "Kategori tidak ditemukan");

  if (before.name !== row.name) {
    await logAudit({
      eventType: "menu.category.update",
      userId: session.user.id,
      entityType: "category",
      entityId: row.id,
      payload: {
        summary: `Rename kategori "${before.name}" → "${row.name}"`,
        before: { name: before.name },
        after: { name: row.name },
      },
      metadata: { outletId: session.user.outletId, actorRole: session.user.role },
    });
  }

  return ok(row);
}

export async function deleteCategory(
  id: string,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireOwnerOrManager("menu.category.crud");

  const [activeCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(menuItems)
    .where(
      and(
        eq(menuItems.categoryId, id),
        eq(menuItems.isActive, true),
        isNull(menuItems.deletedAt),
      ),
    );
  if (activeCount.c > 0) {
    return fail(
      "CATEGORY_HAS_ITEMS",
      "Kategori masih punya item aktif. Hapus/pindahkan dulu.",
    );
  }

  const [before] = await db
    .select({ name: categories.name })
    .from(categories)
    .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
    .limit(1);

  const [row] = await db
    .update(categories)
    .set({ deletedAt: new Date(), updatedBy: session.user.id })
    .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
    .returning({ id: categories.id });

  if (!row) return fail("NOT_FOUND", "Kategori tidak ditemukan");

  await logAudit({
    eventType: "menu.category.delete",
    userId: session.user.id,
    entityType: "category",
    entityId: row.id,
    payload: { summary: `Hapus kategori "${before?.name ?? id}"` },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok({ id: row.id });
}

export async function reorderCategory(
  id: string,
  direction: "up" | "down",
): Promise<ApiResult<{ id: string }>> {
  const session = await requireOwnerOrManager("menu.category.crud");

  const dir = reorderDirSchema.safeParse(direction);
  if (!dir.success) return fail("VALIDATION", "Direction harus up/down");

  const [current] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
    .limit(1);
  if (!current) return fail("NOT_FOUND", "Kategori tidak ditemukan");

  const neighborQuery = direction === "up"
    ? db
        .select()
        .from(categories)
        .where(
          and(
            eq(categories.outletId, current.outletId),
            isNull(categories.deletedAt),
            lt(categories.displayOrder, current.displayOrder),
          ),
        )
        .orderBy(desc(categories.displayOrder))
        .limit(1)
    : db
        .select()
        .from(categories)
        .where(
          and(
            eq(categories.outletId, current.outletId),
            isNull(categories.deletedAt),
            gt(categories.displayOrder, current.displayOrder),
          ),
        )
        .orderBy(asc(categories.displayOrder))
        .limit(1);

  const [neighbor] = await neighborQuery;
  if (!neighbor) return ok({ id: current.id }); // already at edge

  await db.transaction(async (tx) => {
    await tx
      .update(categories)
      .set({
        displayOrder: neighbor.displayOrder,
        updatedAt: new Date(),
        updatedBy: session.user.id,
      })
      .where(eq(categories.id, current.id));
    await tx
      .update(categories)
      .set({
        displayOrder: current.displayOrder,
        updatedAt: new Date(),
        updatedBy: session.user.id,
      })
      .where(eq(categories.id, neighbor.id));
  });

  return ok({ id: current.id });
}

// ---------- Mutations: modifiers ----------

export async function updateModifierPrice(
  slug: string,
  price: number,
): Promise<ApiResult<Modifier>> {
  const session = await requireOwnerOrManager("menu.modifier.update");

  if (!Number.isInteger(price) || price < 0 || price > 999_999_999) {
    return fail("VALIDATION", "Harga harus 0 - 999.999.999");
  }

  const [before] = await db
    .select({ price: modifiers.price, label: modifiers.label })
    .from(modifiers)
    .where(eq(modifiers.slug, slug))
    .limit(1);

  const [row] = await db
    .update(modifiers)
    .set({ price, updatedAt: new Date(), updatedBy: session.user.id })
    .where(eq(modifiers.slug, slug))
    .returning();

  if (!row) return fail("NOT_FOUND", "Modifier tidak ditemukan");

  if (before && before.price !== row.price) {
    await logAudit({
      eventType: "menu.modifier.update",
      userId: session.user.id,
      entityType: "modifier",
      payload: {
        summary: `Update harga modifier "${row.label}": Rp${before.price.toLocaleString("id-ID")} → Rp${row.price.toLocaleString("id-ID")}`,
        before: { price: before.price },
        after: { price: row.price },
        context: { slug: row.slug },
      },
      metadata: { outletId: session.user.outletId, actorRole: session.user.role },
    });
  }

  return ok(row);
}

// Phase 7.1 (sesi AB) — full Modifier CRUD beyond price-only update.

const SLUG_RE = /^[a-z][a-z0-9_]*$/;

export interface ModifierFormInput {
  slug: string;
  label: string;
  type: "single_select" | "toggle";
  price: number;
  options?: Array<{ value: string; label: string }> | null;
  appliesToCategories?: string[] | null;
  isActive?: boolean;
}

function validateModifierInput(input: ModifierFormInput): string | null {
  if (!input.slug || !SLUG_RE.test(input.slug)) {
    return "Slug harus huruf kecil + angka + underscore (mis. extra_shot)";
  }
  if (input.slug.length > 60) return "Slug max 60 karakter";
  if (!input.label || input.label.trim().length === 0) {
    return "Label tidak boleh kosong";
  }
  if (input.label.length > 120) return "Label max 120 karakter";
  if (!Number.isInteger(input.price) || input.price < 0 || input.price > 999_999_999) {
    return "Harga harus 0 - 999.999.999";
  }
  if (input.type === "single_select") {
    if (!input.options || input.options.length === 0) {
      return "single_select wajib punya minimal 1 pilihan";
    }
    for (const opt of input.options) {
      if (!opt.value || !SLUG_RE.test(opt.value)) {
        return `Nilai pilihan "${opt.value}" tidak valid (huruf kecil + underscore)`;
      }
      if (!opt.label || opt.label.trim().length === 0) {
        return `Label pilihan "${opt.value}" tidak boleh kosong`;
      }
    }
  }
  return null;
}

export async function createModifier(
  input: ModifierFormInput,
): Promise<ApiResult<Modifier>> {
  const session = await requireOwnerOrManager("menu.modifier.create");

  const err = validateModifierInput(input);
  if (err) return fail("VALIDATION", err);

  const [existing] = await db
    .select({ slug: modifiers.slug })
    .from(modifiers)
    .where(eq(modifiers.slug, input.slug))
    .limit(1);
  if (existing) return fail("DUPLICATE", `Slug "${input.slug}" sudah dipakai`);

  const [row] = await db
    .insert(modifiers)
    .values({
      slug: input.slug,
      label: input.label.trim(),
      type: input.type,
      price: input.price,
      optionsJson: input.type === "single_select" ? input.options ?? [] : null,
      appliesToCategories:
        input.appliesToCategories && input.appliesToCategories.length > 0
          ? input.appliesToCategories
          : null,
      isActive: input.isActive ?? true,
      updatedBy: session.user.id,
    })
    .returning();

  await logAudit({
    eventType: "menu.modifier.create",
    userId: session.user.id,
    entityType: "modifier",
    payload: {
      summary: `Buat modifier "${row.label}" (${row.slug})`,
      after: { slug: row.slug, label: row.label, type: row.type, price: row.price },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok(row);
}

export async function updateModifier(
  input: ModifierFormInput,
): Promise<ApiResult<Modifier>> {
  const session = await requireOwnerOrManager("menu.modifier.update");

  const err = validateModifierInput(input);
  if (err) return fail("VALIDATION", err);

  const [before] = await db
    .select()
    .from(modifiers)
    .where(eq(modifiers.slug, input.slug))
    .limit(1);
  if (!before) return fail("NOT_FOUND", "Modifier tidak ditemukan");

  const [row] = await db
    .update(modifiers)
    .set({
      label: input.label.trim(),
      type: input.type,
      price: input.price,
      optionsJson: input.type === "single_select" ? input.options ?? [] : null,
      appliesToCategories:
        input.appliesToCategories && input.appliesToCategories.length > 0
          ? input.appliesToCategories
          : null,
      isActive: input.isActive ?? before.isActive,
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(eq(modifiers.slug, input.slug))
    .returning();

  await logAudit({
    eventType: "menu.modifier.update",
    userId: session.user.id,
    entityType: "modifier",
    payload: {
      summary: `Update modifier "${row.label}" (${row.slug})`,
      before: {
        label: before.label,
        type: before.type,
        price: before.price,
        isActive: before.isActive,
      },
      after: {
        label: row.label,
        type: row.type,
        price: row.price,
        isActive: row.isActive,
      },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok(row);
}

export async function deleteModifier(
  slug: string,
): Promise<ApiResult<{ slug: string }>> {
  const session = await requireOwnerOrManager("menu.modifier.delete");

  const [before] = await db
    .select({ slug: modifiers.slug, label: modifiers.label })
    .from(modifiers)
    .where(eq(modifiers.slug, slug))
    .limit(1);
  if (!before) return fail("NOT_FOUND", "Modifier tidak ditemukan");

  await db.delete(modifiers).where(eq(modifiers.slug, slug));

  await logAudit({
    eventType: "menu.modifier.delete",
    userId: session.user.id,
    entityType: "modifier",
    payload: {
      summary: `Hapus modifier "${before.label}" (${slug})`,
      before: { slug: before.slug, label: before.label },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok({ slug });
}

// ---------- Phase 7.2: BOM-based price suggestion ----------

/** Default markup pct kalau outlet belum set defaultMarkupPct di settings.
 * 250% = harga jual = 3.5× COGS. Cocok untuk segmen kafe Mahakan. */
const DEFAULT_MARKUP_PCT = 250;

export interface MenuItemPriceSuggestion {
  /** COGS per variant (Rp). null = recipe variant tidak ada. */
  perVariant: Array<{
    /** "fixed" untuk single-recipe menu, atau "hot"/"iced" untuk variant. */
    variant: "fixed" | "hot" | "iced";
    cogs: number;
    suggestedPrice: number;
  }>;
  /** Markup% yang dipakai (dari outlet settings atau default). */
  markupPct: number;
  /** True kalau outlet sudah override default. */
  fromOutletSetting: boolean;
}

/**
 * Compute COGS per active recipe variant for a menu item, lalu apply markup
 * dari outlet settings (defaultMarkupPct) → suggestedPrice. Owner pakai untuk
 * acuan harga jual baru (Phase 7.2). Return null kalau menu item tidak punya
 * recipe aktif sama sekali.
 *
 * Read-only — tidak mutate menu_items.price; UI yang Apply ke field harga.
 */
export async function computeMenuItemPriceSuggestion(
  menuItemId: string,
): Promise<ApiResult<MenuItemPriceSuggestion | null>> {
  const session = await requireSession();

  const allRecipes = await fetchRecipesForMenuItem(menuItemId);
  const activeRecipes = allRecipes.filter((r) => r.isActive);
  if (activeRecipes.length === 0) return ok(null);

  // Pull outlet markup setting (default 250%)
  const [outletRow] = await db
    .select({ settings: outlets.settings })
    .from(outlets)
    .where(eq(outlets.id, session.user.outletId))
    .limit(1);
  const settingMarkup = outletRow?.settings?.features?.defaultMarkupPct;
  const markupPct =
    typeof settingMarkup === "number" && settingMarkup >= 0
      ? settingMarkup
      : DEFAULT_MARKUP_PCT;
  const fromOutletSetting = typeof settingMarkup === "number";

  const perVariant: MenuItemPriceSuggestion["perVariant"] = [];
  for (const recipe of activeRecipes) {
    const leaves = await expandRecipeToAtomicLeaves(
      db,
      recipe.id,
      session.user.outletId,
    );
    if (leaves.size === 0) continue;
    const leafIds = Array.from(leaves.keys());
    const stockRows = await db
      .select({ id: ingredients.id, costPerUnit: ingredients.costPerUnit })
      .from(ingredients)
      .where(inArray(ingredients.id, leafIds));
    const costById = new Map(stockRows.map((r) => [r.id, r.costPerUnit ?? 0]));
    let cogs = 0;
    for (const [leafId, qty] of leaves) {
      cogs += (costById.get(leafId) ?? 0) * qty;
    }
    cogs = Math.round(cogs);
    // suggestedPrice = COGS × (1 + markupPct/100), rounded to nearest 500 rupiah
    // (kelipatan 500 standard untuk price tag yang clean).
    const rawSuggested = cogs * (1 + markupPct / 100);
    const suggestedPrice = Math.round(rawSuggested / 500) * 500;
    const variantKey: "fixed" | "hot" | "iced" =
      recipe.variant === "hot"
        ? "hot"
        : recipe.variant === "iced"
          ? "iced"
          : "fixed";
    perVariant.push({ variant: variantKey, cogs, suggestedPrice });
  }

  if (perVariant.length === 0) return ok(null);
  return ok({ perVariant, markupPct, fromOutletSetting });
}

// ---------- Bulk operations ----------

/**
 * Bulk operations on menu items. Action determines which fields are touched:
 * - mark_sold_out / mark_available: toggles `isSoldOut`
 * - adjust_price_pct: scales priceFixed/priceHot/priceIced by (1 + pct/100),
 *   rounded to integer rupiah; skips items with priceType="open"
 *
 * Single audit event per bulk operation (with affected ids in payload) — keeps
 * the audit log readable when Owner does a 30-item adjustment.
 */
export type BulkAction =
  | { kind: "mark_sold_out" }
  | { kind: "mark_available" }
  | { kind: "adjust_price_pct"; pct: number };

export async function bulkUpdateMenuItems(
  ids: string[],
  action: BulkAction,
): Promise<ApiResult<{ affected: number }>> {
  const session = await requireOwnerOrManager("menu.item.bulk_update");
  if (!Array.isArray(ids) || ids.length === 0) {
    return fail("VALIDATION", "Pilih minimal 1 item");
  }
  if (ids.length > 200) {
    return fail("VALIDATION", "Maks 200 item per operasi bulk");
  }
  for (const id of ids) {
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) {
      return fail("VALIDATION", "ID tidak valid");
    }
  }

  if (action.kind === "mark_sold_out" || action.kind === "mark_available") {
    const isSoldOut = action.kind === "mark_sold_out";
    const perm = isSoldOut ? "pos.menu.mark_sold_out" : "pos.menu.mark_available";
    if (!hasPermission(session.user.role, perm)) {
      return fail("FORBIDDEN", `Tidak punya hak ${action.kind}`);
    }

    await db
      .update(menuItems)
      .set({ isSoldOut, updatedAt: new Date(), updatedBy: session.user.id })
      .where(
        and(
          sql`${menuItems.id} in ${ids}`,
          isNull(menuItems.deletedAt),
        ),
      );

    await logAudit({
      eventType: "menu.item.sold_out_toggle",
      userId: session.user.id,
      entityType: "menu_item",
      payload: {
        summary: `Bulk ${isSoldOut ? "sold-out" : "tersedia"}: ${ids.length} item`,
        context: { isSoldOut, ids, count: ids.length, bulk: true },
      },
      metadata: { outletId: session.user.outletId, actorRole: session.user.role },
    });

    return ok({ affected: ids.length });
  }

  // adjust_price_pct
  const pct = action.pct;
  if (!Number.isFinite(pct) || pct <= -100 || pct > 1000) {
    return fail("VALIDATION", "Persen harus > -100 dan ≤ 1000");
  }

  // Fetch current prices for affected items (skip open-price)
  const rows = await db
    .select({
      id: menuItems.id,
      name: menuItems.name,
      priceType: menuItems.priceType,
      priceFixed: menuItems.priceFixed,
      priceHot: menuItems.priceHot,
      priceIced: menuItems.priceIced,
    })
    .from(menuItems)
    .where(
      and(
        sql`${menuItems.id} in ${ids}`,
        isNull(menuItems.deletedAt),
      ),
    );

  const factor = 1 + pct / 100;
  const apply = (n: number | null) =>
    n == null ? null : Math.max(0, Math.round(n * factor));

  let affected = 0;
  await db.transaction(async (tx) => {
    for (const r of rows) {
      if (r.priceType === "open") continue;
      const next = {
        priceFixed: apply(r.priceFixed),
        priceHot: apply(r.priceHot),
        priceIced: apply(r.priceIced),
      };
      await tx
        .update(menuItems)
        .set({
          ...next,
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(eq(menuItems.id, r.id));
      affected += 1;
    }
  });

  await logAudit({
    eventType: "menu.item.update",
    userId: session.user.id,
    entityType: "menu_item",
    payload: {
      summary: `Bulk price ${pct > 0 ? "+" : ""}${pct}%: ${affected} item`,
      context: {
        bulk: true,
        pct,
        affectedIds: rows
          .filter((r) => r.priceType !== "open")
          .map((r) => r.id),
        skippedOpenPrice: rows.filter((r) => r.priceType === "open").length,
      },
    },
    metadata: { outletId: session.user.outletId, actorRole: session.user.role },
  });

  return ok({ affected });
}

/**
 * Owner-only menu CSV export. Returns a CSV string (caller triggers download).
 */
export async function exportMenuCsv(): Promise<ApiResult<string>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "menu.export_csv")) {
    return fail("FORBIDDEN", "Export CSV hanya untuk Owner");
  }

  const rows = await db
    .select({
      id: menuItems.id,
      name: menuItems.name,
      categoryName: categories.name,
      priceType: menuItems.priceType,
      priceFixed: menuItems.priceFixed,
      priceHot: menuItems.priceHot,
      priceIced: menuItems.priceIced,
      isSignature: menuItems.isSignature,
      isSoldOut: menuItems.isSoldOut,
      isActive: menuItems.isActive,
      displayOrder: menuItems.displayOrder,
      description: menuItems.description,
    })
    .from(menuItems)
    .leftJoin(categories, eq(categories.id, menuItems.categoryId))
    .where(isNull(menuItems.deletedAt))
    .orderBy(asc(categories.displayOrder), asc(menuItems.displayOrder));

  const escape = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const headers = [
    "id",
    "name",
    "category",
    "priceType",
    "priceFixed",
    "priceHot",
    "priceIced",
    "isSignature",
    "isSoldOut",
    "isActive",
    "displayOrder",
    "description",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.name,
        r.categoryName,
        r.priceType,
        r.priceFixed,
        r.priceHot,
        r.priceIced,
        r.isSignature,
        r.isSoldOut,
        r.isActive,
        r.displayOrder,
        r.description,
      ]
        .map(escape)
        .join(","),
    );
  }

  return ok(lines.join("\n"));
}
