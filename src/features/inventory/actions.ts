"use server";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { ingredients, inventoryMovements } from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { diffShallow, logAudit } from "@/lib/audit/logger";
import {
  fetchIngredientById,
  fetchIngredients,
  fetchLowStockIngredients,
  fetchMovements,
  type ListIngredientsOptions,
} from "./queries";
import {
  adjustStockSchema,
  createIngredientSchema,
  receiveStockSchema,
  recordWasteSchema,
  updateIngredientSchema,
} from "./schemas";
import {
  fail,
  ok,
  type ApiResult,
  type AdjustStockInput,
  type CreateIngredientInput,
  type Ingredient,
  type InventoryMovement,
  type ListMovementsOptions,
  type MovementWithIngredient,
  type Paginated,
  type ReceiveStockInput,
  type RecordWasteInput,
  type UpdateIngredientInput,
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

