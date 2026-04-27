"use server";

import { and, eq, isNull, gt, lt, asc, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, menuItems, modifiers } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { diffShallow, logAudit } from "@/lib/audit";
import {
  fetchAllCategories,
  fetchCategories,
  fetchMenuItemById,
  fetchMenuItems,
  fetchModifiers,
  fetchModifiersForCategory,
  type ListMenuItemsOptions,
} from "./queries";
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
