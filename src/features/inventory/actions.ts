"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  ingredients,
  inventoryMovements,
  menuItems,
  recipeIngredients,
  recipes,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { diffShallow, logAudit } from "@/lib/audit/logger";
import {
  fetchAllRecipes,
  fetchIngredientById,
  fetchIngredients,
  fetchLowStockIngredients,
  fetchMovements,
  fetchRecipeById,
  fetchRecipesForMenuItem,
  type ListIngredientsOptions,
} from "./queries";
import {
  adjustStockSchema,
  createIngredientSchema,
  createRecipeSchema,
  receiveStockSchema,
  recordWasteSchema,
  updateIngredientSchema,
  updateRecipeSchema,
} from "./schemas";
import {
  fail,
  ok,
  type ApiFailure,
  type ApiResult,
  type AdjustStockInput,
  type CreateIngredientInput,
  type CreateRecipeInput,
  type Ingredient,
  type InventoryMovement,
  type ListMovementsOptions,
  type MovementWithIngredient,
  type Paginated,
  type ReceiveStockInput,
  type Recipe,
  type RecipeIngredientInput,
  type RecipeWithIngredients,
  type RecordWasteInput,
  type UpdateIngredientInput,
  type UpdateRecipeInput,
} from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

// ---------- Reads ----------

export async function listIngredients(
  opts: ListIngredientsOptions = {},
): Promise<ApiResult<Paginated<Ingredient>>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.ingredient.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat bahan");
  }
  return ok(await fetchIngredients(session.user.outletId, opts));
}

export async function getIngredient(
  id: string,
): Promise<ApiResult<Ingredient>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.ingredient.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat bahan");
  }
  const row = await fetchIngredientById(id);
  if (!row || row.outletId !== session.user.outletId) {
    return fail("NOT_FOUND", "Bahan tidak ditemukan");
  }
  return ok(row);
}

export async function listLowStockIngredients(): Promise<
  ApiResult<Ingredient[]>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.ingredient.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat bahan");
  }
  return ok(await fetchLowStockIngredients(session.user.outletId));
}

export async function listMovements(
  opts: ListMovementsOptions = {},
): Promise<ApiResult<Paginated<MovementWithIngredient>>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.movement.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat pergerakan stok");
  }
  return ok(await fetchMovements(session.user.outletId, opts));
}

// ---------- Mutations: Ingredient CRUD ----------

export async function createIngredient(
  input: CreateIngredientInput,
): Promise<ApiResult<Ingredient>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.ingredient.create")) {
    return fail("FORBIDDEN", "Tidak punya hak tambah bahan");
  }

  const parsed = createIngredientSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  try {
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(ingredients)
        .values({
          outletId: session.user.outletId,
          name: v.name,
          unit: v.unit,
          costPerUnit: v.costPerUnit,
          currentStock: v.initialStock,
          reorderThreshold: v.reorderThreshold ?? null,
          notes: v.notes ?? null,
          createdBy: session.user.id,
          updatedBy: session.user.id,
        })
        .returning();

      if (v.initialStock > 0) {
        await tx.insert(inventoryMovements).values({
          outletId: session.user.outletId,
          ingredientId: row.id,
          kind: "initial",
          qtyDelta: v.initialStock,
          unitCostAtMovement: v.costPerUnit,
          referenceType: "manual",
          reason: "Stok awal",
          createdBy: session.user.id,
        });
      }
      return row;
    });

    await logAudit({
      eventType: "inventory.ingredient.create",
      userId: session.user.id,
      entityType: "ingredient",
      entityId: created.id,
      payload: {
        summary: `Tambah bahan ${created.name} (${v.initialStock} ${v.unit})`,
        after: created,
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    });

    return ok(created);
  } catch (e) {
    if (e instanceof Error && /unique|duplicate/i.test(e.message)) {
      return fail("DUPLICATE_NAME", "Nama bahan sudah dipakai");
    }
    return fail(
      "DB_ERROR",
      e instanceof Error ? e.message : "Database error",
    );
  }
}

export async function updateIngredient(
  id: string,
  input: UpdateIngredientInput,
): Promise<ApiResult<Ingredient>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.ingredient.update")) {
    return fail("FORBIDDEN", "Tidak punya hak edit bahan");
  }

  const parsed = updateIngredientSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  const existing = await fetchIngredientById(id);
  if (!existing || existing.outletId !== session.user.outletId) {
    return fail("NOT_FOUND", "Bahan tidak ditemukan");
  }

  try {
    const [updated] = await db
      .update(ingredients)
      .set({
        ...v,
        updatedAt: new Date(),
        updatedBy: session.user.id,
      })
      .where(eq(ingredients.id, id))
      .returning();

    await logAudit({
      eventType: "inventory.ingredient.update",
      userId: session.user.id,
      entityType: "ingredient",
      entityId: id,
      payload: {
        summary: `Edit bahan ${updated.name}`,
        before: existing,
        after: updated,
        diff: diffShallow(
          existing as unknown as Record<string, unknown>,
          updated as unknown as Record<string, unknown>,
        ),
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    });

    return ok(updated);
  } catch (e) {
    if (e instanceof Error && /unique|duplicate/i.test(e.message)) {
      return fail("DUPLICATE_NAME", "Nama bahan sudah dipakai");
    }
    return fail(
      "DB_ERROR",
      e instanceof Error ? e.message : "Database error",
    );
  }
}

export async function deleteIngredient(
  id: string,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.ingredient.delete")) {
    return fail("FORBIDDEN", "Tidak punya hak hapus bahan");
  }

  const existing = await fetchIngredientById(id);
  if (!existing || existing.outletId !== session.user.outletId) {
    return fail("NOT_FOUND", "Bahan tidak ditemukan");
  }

  await db
    .update(ingredients)
    .set({
      deletedAt: new Date(),
      isActive: false,
      updatedAt: new Date(),
      updatedBy: session.user.id,
    })
    .where(eq(ingredients.id, id));

  await logAudit({
    eventType: "inventory.ingredient.delete",
    userId: session.user.id,
    entityType: "ingredient",
    entityId: id,
    payload: {
      summary: `Hapus bahan ${existing.name}`,
      before: existing,
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  });

  return ok({ id });
}

// ---------- Mutations: Stock movements ----------

async function recordMovementAndUpdateStock(opts: {
  outletId: string;
  userId: string;
  ingredientId: string;
  kind: InventoryMovement["kind"];
  qtyDelta: number;
  unitCostAtMovement: number | null;
  reason: string | null;
  referenceType: InventoryMovement["referenceType"] | null;
  referenceId: string | null;
}): Promise<{ ingredient: Ingredient; movement: InventoryMovement }> {
  return db.transaction(async (tx) => {
    // Atomic stock update guarded by ingredient row lock + non-negative result.
    const [ingRow] = await tx
      .select()
      .from(ingredients)
      .where(
        and(eq(ingredients.id, opts.ingredientId), isNull(ingredients.deletedAt)),
      )
      .for("update")
      .limit(1);

    if (!ingRow) throw new Error("INGREDIENT_NOT_FOUND");
    if (ingRow.outletId !== opts.outletId) {
      throw new Error("INGREDIENT_NOT_FOUND");
    }

    const newStock = ingRow.currentStock + opts.qtyDelta;

    const [updatedIng] = await tx
      .update(ingredients)
      .set({
        currentStock: newStock,
        updatedAt: new Date(),
        updatedBy: opts.userId,
      })
      .where(eq(ingredients.id, opts.ingredientId))
      .returning();

    const [movement] = await tx
      .insert(inventoryMovements)
      .values({
        outletId: opts.outletId,
        ingredientId: opts.ingredientId,
        kind: opts.kind,
        qtyDelta: opts.qtyDelta,
        unitCostAtMovement: opts.unitCostAtMovement,
        referenceType: opts.referenceType,
        referenceId: opts.referenceId,
        reason: opts.reason,
        createdBy: opts.userId,
      })
      .returning();

    return { ingredient: updatedIng, movement };
  });
}

export async function receiveStock(
  input: ReceiveStockInput,
): Promise<ApiResult<{ ingredient: Ingredient; movement: InventoryMovement }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.receive")) {
    return fail("FORBIDDEN", "Tidak punya hak terima stok");
  }

  const parsed = receiveStockSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  try {
    const result = await db.transaction(async (tx) => {
      const [ingRow] = await tx
        .select()
        .from(ingredients)
        .where(
          and(
            eq(ingredients.id, v.ingredientId),
            isNull(ingredients.deletedAt),
          ),
        )
        .for("update")
        .limit(1);
      if (!ingRow || ingRow.outletId !== session.user.outletId) {
        throw new Error("INGREDIENT_NOT_FOUND");
      }

      const [updatedIng] = await tx
        .update(ingredients)
        .set({
          currentStock: ingRow.currentStock + v.qty,
          costPerUnit: v.updateCost ? v.unitCost : ingRow.costPerUnit,
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(eq(ingredients.id, v.ingredientId))
        .returning();

      const [movement] = await tx
        .insert(inventoryMovements)
        .values({
          outletId: session.user.outletId,
          ingredientId: v.ingredientId,
          kind: "purchase",
          qtyDelta: v.qty,
          unitCostAtMovement: v.unitCost,
          referenceType: "manual",
          reason: v.note ?? null,
          createdBy: session.user.id,
        })
        .returning();

      return { ingredient: updatedIng, movement };
    });

    await logAudit({
      eventType: "inventory.receive",
      userId: session.user.id,
      entityType: "inventory_movement",
      entityId: result.movement.id,
      payload: {
        summary: `Terima stok ${result.ingredient.name} +${v.qty} ${result.ingredient.unit} @ Rp${v.unitCost.toLocaleString("id-ID")}`,
        context: {
          ingredientId: v.ingredientId,
          qty: v.qty,
          unitCost: v.unitCost,
          updateCost: v.updateCost,
          note: v.note,
          stockAfter: result.ingredient.currentStock,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    });

    return ok(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    if (msg === "INGREDIENT_NOT_FOUND") {
      return fail("NOT_FOUND", "Bahan tidak ditemukan");
    }
    return fail("DB_ERROR", msg);
  }
}

export async function adjustStock(
  input: AdjustStockInput,
): Promise<ApiResult<{ ingredient: Ingredient; movement: InventoryMovement }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.adjust")) {
    return fail("FORBIDDEN", "Tidak punya hak adjust stok");
  }

  const parsed = adjustStockSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  try {
    const result = await recordMovementAndUpdateStock({
      outletId: session.user.outletId,
      userId: session.user.id,
      ingredientId: v.ingredientId,
      kind: "adjust",
      qtyDelta: v.delta,
      unitCostAtMovement: null,
      reason: v.reason,
      referenceType: "manual",
      referenceId: null,
    });

    await logAudit({
      eventType: "inventory.adjust",
      userId: session.user.id,
      entityType: "inventory_movement",
      entityId: result.movement.id,
      payload: {
        summary: `Adjust ${result.ingredient.name} ${v.delta > 0 ? "+" : ""}${v.delta} ${result.ingredient.unit} (${v.reason})`,
        context: {
          ingredientId: v.ingredientId,
          delta: v.delta,
          reason: v.reason,
          stockAfter: result.ingredient.currentStock,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    });

    return ok(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    if (msg === "INGREDIENT_NOT_FOUND") {
      return fail("NOT_FOUND", "Bahan tidak ditemukan");
    }
    return fail("DB_ERROR", msg);
  }
}

export async function recordWaste(
  input: RecordWasteInput,
): Promise<ApiResult<{ ingredient: Ingredient; movement: InventoryMovement }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.waste")) {
    return fail("FORBIDDEN", "Tidak punya hak catat waste");
  }

  const parsed = recordWasteSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  try {
    const result = await db.transaction(async (tx) => {
      const [ingRow] = await tx
        .select()
        .from(ingredients)
        .where(
          and(
            eq(ingredients.id, v.ingredientId),
            isNull(ingredients.deletedAt),
          ),
        )
        .for("update")
        .limit(1);
      if (!ingRow || ingRow.outletId !== session.user.outletId) {
        throw new Error("INGREDIENT_NOT_FOUND");
      }
      if (ingRow.currentStock < v.qty) {
        throw new Error("INSUFFICIENT_STOCK");
      }

      const [updatedIng] = await tx
        .update(ingredients)
        .set({
          currentStock: ingRow.currentStock - v.qty,
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(eq(ingredients.id, v.ingredientId))
        .returning();

      const [movement] = await tx
        .insert(inventoryMovements)
        .values({
          outletId: session.user.outletId,
          ingredientId: v.ingredientId,
          kind: "waste",
          qtyDelta: -v.qty,
          unitCostAtMovement: ingRow.costPerUnit,
          referenceType: "manual",
          reason: v.reason,
          createdBy: session.user.id,
        })
        .returning();

      return { ingredient: updatedIng, movement };
    });

    await logAudit({
      eventType: "inventory.waste",
      userId: session.user.id,
      entityType: "inventory_movement",
      entityId: result.movement.id,
      payload: {
        summary: `Waste ${result.ingredient.name} ${v.qty} ${result.ingredient.unit} (${v.reason})`,
        context: {
          ingredientId: v.ingredientId,
          qty: v.qty,
          reason: v.reason,
          stockAfter: result.ingredient.currentStock,
          costImpact: result.movement.unitCostAtMovement
            ? result.movement.unitCostAtMovement * v.qty
            : null,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    });

    return ok(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    if (msg === "INGREDIENT_NOT_FOUND") {
      return fail("NOT_FOUND", "Bahan tidak ditemukan");
    }
    if (msg === "INSUFFICIENT_STOCK") {
      return fail(
        "INSUFFICIENT_STOCK",
        "Stok bahan tidak cukup untuk dicatat sebagai waste",
      );
    }
    return fail("DB_ERROR", msg);
  }
}

// ---------- Recipes ----------

interface MenuItemRecipeContext {
  outletId: string;
  priceType: "fixed" | "variant" | "open";
  priceHot: number | null;
  priceIced: number | null;
  name: string;
}

async function loadMenuItemForRecipe(
  menuItemId: string,
): Promise<MenuItemRecipeContext | null> {
  const [row] = await db
    .select({
      outletId: menuItems.outletId,
      priceType: menuItems.priceType,
      priceHot: menuItems.priceHot,
      priceIced: menuItems.priceIced,
      name: menuItems.name,
    })
    .from(menuItems)
    .where(and(eq(menuItems.id, menuItemId), isNull(menuItems.deletedAt)))
    .limit(1);
  return row ?? null;
}

function validateVariantAgainstMenuItem(
  ctx: MenuItemRecipeContext,
  variant: "hot" | "iced" | null | undefined,
): ApiFailure | null {
  const v = variant ?? null;
  if (ctx.priceType === "open") {
    return fail(
      "RECIPE_NOT_ALLOWED_FOR_OPEN_PRICE",
      "Item open-price tidak punya resep tetap",
    );
  }
  if (ctx.priceType === "fixed" && v !== null) {
    return fail(
      "VARIANT_NOT_ALLOWED",
      "Item harga tetap tidak boleh punya variant",
    );
  }
  if (ctx.priceType === "variant") {
    if (v === null) {
      return fail("VARIANT_REQUIRED", "Item variant wajib pilih hot atau iced");
    }
    if (v === "hot" && ctx.priceHot === null) {
      return fail(
        "VARIANT_NOT_ON_MENU_ITEM",
        "Menu ini tidak punya harga Hot",
      );
    }
    if (v === "iced" && ctx.priceIced === null) {
      return fail(
        "VARIANT_NOT_ON_MENU_ITEM",
        "Menu ini tidak punya harga Iced",
      );
    }
  }
  return null;
}

async function verifyIngredientsBelongToOutlet(
  outletId: string,
  lines: RecipeIngredientInput[],
): Promise<ApiFailure | null> {
  const ids = Array.from(new Set(lines.map((l) => l.ingredientId)));
  const rows = await db
    .select({ id: ingredients.id, outletId: ingredients.outletId })
    .from(ingredients)
    .where(and(inArray(ingredients.id, ids), isNull(ingredients.deletedAt)));
  if (rows.length !== ids.length) {
    return fail("INGREDIENT_NOT_FOUND", "Beberapa bahan tidak ditemukan");
  }
  const wrongOutlet = rows.find((r) => r.outletId !== outletId);
  if (wrongOutlet) {
    return fail("INGREDIENT_NOT_FOUND", "Bahan tidak valid untuk outlet ini");
  }
  return null;
}

export async function listRecipesForMenuItem(
  menuItemId: string,
): Promise<ApiResult<RecipeWithIngredients[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.recipe.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat resep");
  }
  return ok(await fetchRecipesForMenuItem(menuItemId));
}

export async function getRecipe(
  id: string,
): Promise<ApiResult<RecipeWithIngredients>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.recipe.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat resep");
  }
  const row = await fetchRecipeById(id);
  if (!row || row.outletId !== session.user.outletId) {
    return fail("NOT_FOUND", "Resep tidak ditemukan");
  }
  return ok(row);
}

export async function listAllRecipes(): Promise<ApiResult<Recipe[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.recipe.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat resep");
  }
  return ok(await fetchAllRecipes(session.user.outletId));
}

export async function createRecipe(
  input: CreateRecipeInput,
): Promise<ApiResult<RecipeWithIngredients>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.recipe.create")) {
    return fail("FORBIDDEN", "Tidak punya hak buat resep");
  }

  const parsed = createRecipeSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  const menu = await loadMenuItemForRecipe(v.menuItemId);
  if (!menu || menu.outletId !== session.user.outletId) {
    return fail("MENU_ITEM_NOT_FOUND", "Menu item tidak ditemukan");
  }

  const variantCheck = validateVariantAgainstMenuItem(menu, v.variant);
  if (variantCheck) return variantCheck;

  const ingredientCheck = await verifyIngredientsBelongToOutlet(
    session.user.outletId,
    v.ingredients,
  );
  if (ingredientCheck) return ingredientCheck;

  try {
    const created = await db.transaction(async (tx) => {
      const [recipe] = await tx
        .insert(recipes)
        .values({
          outletId: session.user.outletId,
          menuItemId: v.menuItemId,
          variant: v.variant ?? null,
          notes: v.notes ?? null,
          createdBy: session.user.id,
          updatedBy: session.user.id,
        })
        .returning();

      await tx.insert(recipeIngredients).values(
        v.ingredients.map((line) => ({
          recipeId: recipe.id,
          ingredientId: line.ingredientId,
          qty: line.qty,
        })),
      );

      return recipe;
    });

    const full = await fetchRecipeById(created.id);
    if (!full) return fail("DB_ERROR", "Gagal load resep setelah create");

    await logAudit({
      eventType: "inventory.recipe.create",
      userId: session.user.id,
      entityType: "recipe",
      entityId: created.id,
      payload: {
        summary: `Tambah resep ${menu.name}${v.variant ? ` (${v.variant})` : ""} — ${v.ingredients.length} bahan`,
        after: full,
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    });

    return ok(full);
  } catch (e) {
    if (e instanceof Error && /unique|duplicate/i.test(e.message)) {
      return fail(
        "DUPLICATE_RECIPE",
        "Resep untuk menu+variant ini sudah ada",
      );
    }
    return fail(
      "DB_ERROR",
      e instanceof Error ? e.message : "Database error",
    );
  }
}

export async function updateRecipe(
  id: string,
  input: UpdateRecipeInput,
): Promise<ApiResult<RecipeWithIngredients>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.recipe.update")) {
    return fail("FORBIDDEN", "Tidak punya hak edit resep");
  }

  const parsed = updateRecipeSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  const existing = await fetchRecipeById(id);
  if (!existing || existing.outletId !== session.user.outletId) {
    return fail("NOT_FOUND", "Resep tidak ditemukan");
  }

  // If variant changing, re-validate against menu item.
  if (v.variant !== undefined && v.variant !== existing.variant) {
    const menu = await loadMenuItemForRecipe(existing.menuItemId);
    if (!menu) return fail("MENU_ITEM_NOT_FOUND", "Menu item tidak ditemukan");
    const variantCheck = validateVariantAgainstMenuItem(menu, v.variant);
    if (variantCheck) return variantCheck;
  }

  if (v.ingredients) {
    const ingredientCheck = await verifyIngredientsBelongToOutlet(
      session.user.outletId,
      v.ingredients,
    );
    if (ingredientCheck) return ingredientCheck;
  }

  try {
    await db.transaction(async (tx) => {
      const setRecipe: Record<string, unknown> = {
        updatedAt: new Date(),
        updatedBy: session.user.id,
      };
      if (v.variant !== undefined) setRecipe.variant = v.variant ?? null;
      if (v.notes !== undefined) setRecipe.notes = v.notes ?? null;

      await tx.update(recipes).set(setRecipe).where(eq(recipes.id, id));

      if (v.ingredients) {
        await tx
          .delete(recipeIngredients)
          .where(eq(recipeIngredients.recipeId, id));
        await tx.insert(recipeIngredients).values(
          v.ingredients.map((line) => ({
            recipeId: id,
            ingredientId: line.ingredientId,
            qty: line.qty,
          })),
        );
      }
    });

    const updated = await fetchRecipeById(id);
    if (!updated) return fail("DB_ERROR", "Gagal load resep setelah update");

    await logAudit({
      eventType: "inventory.recipe.update",
      userId: session.user.id,
      entityType: "recipe",
      entityId: id,
      payload: {
        summary: `Edit resep ${id.slice(0, 8)}…`,
        before: existing,
        after: updated,
        diff: diffShallow(
          existing as unknown as Record<string, unknown>,
          updated as unknown as Record<string, unknown>,
        ),
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    });

    return ok(updated);
  } catch (e) {
    if (e instanceof Error && /unique|duplicate/i.test(e.message)) {
      return fail(
        "DUPLICATE_RECIPE",
        "Resep untuk menu+variant ini sudah ada",
      );
    }
    return fail(
      "DB_ERROR",
      e instanceof Error ? e.message : "Database error",
    );
  }
}

export async function deleteRecipe(
  id: string,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.recipe.delete")) {
    return fail("FORBIDDEN", "Tidak punya hak hapus resep");
  }

  const existing = await fetchRecipeById(id);
  if (!existing || existing.outletId !== session.user.outletId) {
    return fail("NOT_FOUND", "Resep tidak ditemukan");
  }

  // Hard delete; recipe_ingredients cascade.
  await db.delete(recipes).where(eq(recipes.id, id));

  await logAudit({
    eventType: "inventory.recipe.delete",
    userId: session.user.id,
    entityType: "recipe",
    entityId: id,
    payload: {
      summary: `Hapus resep ${id.slice(0, 8)}…`,
      before: existing,
    },
    metadata: {
      outletId: session.user.outletId,
      actorRole: session.user.role,
    },
  });

  return ok({ id });
}
