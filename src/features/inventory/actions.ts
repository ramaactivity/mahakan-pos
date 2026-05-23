"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  ingredients,
  inventoryMovements,
  menuItems,
  recipeIngredients,
  recipes,
  stockOpnameLines,
  stockOpnameSessions,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import { diffShallow, logAudit } from "@/lib/audit/logger";
import { monthWibRangeUtc } from "@/lib/date";
import { logAndSanitize } from "@/lib/server-error";
import {
  computeNewStock,
  formatMovementDelta,
  resolveStockDecimal,
} from "@/lib/stock-decimal";
import { fetchHppReport } from "@/features/reports/inventory-reports";
import type { HppReportRow } from "@/features/reports";
import {
  cascadeCostUpdate,
  detectCycleForRecipeUpsert,
} from "./preparation-flow";
import {
  fetchAllRecipes,
  fetchAtomicIngredients,
  fetchIngredientById,
  fetchIngredients,
  fetchLowStockIngredients,
  fetchMovements,
  fetchPreparations,
  fetchRecipeById,
  fetchRecipeForPreparation,
  fetchRecipesForMenuItem,
  type ListIngredientsOptions,
} from "./queries";
import {
  adjustStockSchema,
  bulkAssignSectionSchema,
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
  type BulkAssignSectionInput,
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

export async function listAtomicIngredients(
  opts: ListIngredientsOptions = {},
): Promise<ApiResult<Paginated<Ingredient>>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.ingredient.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat bahan");
  }
  return ok(await fetchAtomicIngredients(session.user.outletId, opts));
}

export async function listPreparations(
  opts: ListIngredientsOptions = {},
): Promise<ApiResult<Paginated<Ingredient>>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.preparation.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat preparation");
  }
  return ok(await fetchPreparations(session.user.outletId, opts));
}

export async function getPreparationRecipe(
  ingredientId: string,
): Promise<ApiResult<RecipeWithIngredients | null>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.preparation.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat preparation");
  }
  const recipe = await fetchRecipeForPreparation(ingredientId);
  if (recipe && recipe.outletId !== session.user.outletId) {
    return fail("NOT_FOUND", "Preparation tidak ditemukan");
  }
  return ok(recipe);
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

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/* Sesi AE-58 — Inventory Monthly Flow per ingredient (Stok Awal / Pembelian
 * / Stok Akhir / HPP). Delegate ke fetchHppReport yang sudah handle opname +
 * purchases + fallback partial flag. Caller (UI) yang group by section. */
export async function getIngredientMonthlyFlow(
  yyyymm: string,
): Promise<ApiResult<HppReportRow[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.ingredient.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat pergerakan stok");
  }
  if (!MONTH_RE.test(yyyymm)) {
    return fail("VALIDATION_ERROR", "Format bulan harus YYYY-MM");
  }
  try {
    const { fromIso, toIso } = monthWibRangeUtc(yyyymm);
    const report = await fetchHppReport(
      session.user.outletId,
      fromIso,
      toIso,
    );
    return ok(report.rows);
  } catch (e) {
    return fail(
      "DB_ERROR",
      logAndSanitize(e, "inventory.monthly_flow", "Gagal memuat pergerakan"),
    );
  }
}

/* Sesi AE-58 — Movements list per ingredient untuk bulan tertentu (drill-down
 * modal). Re-use fetchMovements yang sudah accept ingredientId + dateFrom/
 * dateTo. Default limit 200 cukup untuk bulan typical (avg <50/bahan). */
export async function getIngredientMovementsInMonth(
  ingredientId: string,
  yyyymm: string,
): Promise<ApiResult<Paginated<MovementWithIngredient>>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.movement.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat pergerakan stok");
  }
  if (!MONTH_RE.test(yyyymm)) {
    return fail("VALIDATION_ERROR", "Format bulan harus YYYY-MM");
  }
  const { fromIso, toIso } = monthWibRangeUtc(yyyymm);
  // Convert WIB dates ke UTC Date objects (inclusive end)
  const dateFrom = new Date(`${fromIso}T00:00:00+07:00`);
  const dateTo = new Date(`${toIso}T23:59:59.999+07:00`);
  return ok(
    await fetchMovements(session.user.outletId, {
      ingredientId,
      dateFrom,
      dateTo,
      limit: 200,
    }),
  );
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
      // Sesi AE-12 — initial stock juga write decimal mirror.
      const initialMovement = formatMovementDelta(v.initialStock);
      const [row] = await tx
        .insert(ingredients)
        .values({
          outletId: session.user.outletId,
          name: v.name,
          unit: v.unit,
          costPerUnit: v.costPerUnit,
          currentStock: v.initialStock,
          currentStockDecimal: v.initialStock.toFixed(4),
          reorderThreshold: v.reorderThreshold ?? null,
          notes: v.notes ?? null,
          isPreparation: v.isPreparation ?? false,
          preparationYield: v.preparationYield ?? null,
          section: v.section ?? null,
          /* Sesi AE-130 — multi-unit tier. Label kosong → NULL = disabled. */
          unitTracking: v.unitTracking?.trim() || null,
          unitTrackingPerCogs:
            v.unitTrackingPerCogs != null
              ? v.unitTrackingPerCogs.toFixed(4)
              : null,
          unitBelanja: v.unitBelanja?.trim() || null,
          unitBelanjaPerCogs:
            v.unitBelanjaPerCogs != null
              ? v.unitBelanjaPerCogs.toFixed(4)
              : null,
          createdBy: session.user.id,
          updatedBy: session.user.id,
        })
        .returning();

      if (v.initialStock > 0) {
        await tx.insert(inventoryMovements).values({
          outletId: session.user.outletId,
          ingredientId: row.id,
          kind: "initial",
          qtyDelta: initialMovement.bigint,
          qtyDeltaDecimal: initialMovement.decimal,
          unitCostAtMovement: v.costPerUnit,
          referenceType: "manual",
          reason: "Stok awal",
          createdBy: session.user.id,
        });
      }
      return row;
    });

    await logAudit({
      eventType: created.isPreparation
        ? "inventory.preparation.create"
        : "inventory.ingredient.create",
      userId: session.user.id,
      entityType: "ingredient",
      entityId: created.id,
      payload: {
        summary: created.isPreparation
          ? `Tambah preparation ${created.name} (yield ${created.preparationYield} ${created.unit})`
          : `Tambah bahan ${created.name} (${v.initialStock} ${v.unit})`,
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
    // costPerUnit (or preparationYield, which folds into derived cost) change
    // triggers cascade — wrap UPDATE + cascade in one tx so audit + cost stamps
    // commit atomically. Advisory lock inside cascadeCostUpdate serializes
    // concurrent edits per outlet.
    const result = await db.transaction(async (tx) => {
      /* Sesi AE-130 — numeric → string coercion. Drizzle numeric column
       * di .set() expect string atau SQL. Explicit destructure supaya
       * unit_tracking_per_cogs + unit_belanja_per_cogs di-serialize
       * benar (4 decimal precision), plus normalize label kosong → NULL. */
      const {
        unitTracking,
        unitTrackingPerCogs,
        unitBelanja,
        unitBelanjaPerCogs,
        ...rest
      } = v;
      const setValues: Record<string, unknown> = {
        ...rest,
        updatedAt: new Date(),
        updatedBy: session.user.id,
      };
      if (unitTracking !== undefined) {
        setValues.unitTracking = unitTracking?.trim() || null;
      }
      if (unitTrackingPerCogs !== undefined) {
        setValues.unitTrackingPerCogs =
          unitTrackingPerCogs == null
            ? null
            : unitTrackingPerCogs.toFixed(4);
      }
      if (unitBelanja !== undefined) {
        setValues.unitBelanja = unitBelanja?.trim() || null;
      }
      if (unitBelanjaPerCogs !== undefined) {
        setValues.unitBelanjaPerCogs =
          unitBelanjaPerCogs == null
            ? null
            : unitBelanjaPerCogs.toFixed(4);
      }
      const [updated] = await tx
        .update(ingredients)
        .set(setValues)
        .where(eq(ingredients.id, id))
        .returning();

      const costChanged = v.costPerUnit !== undefined
        && v.costPerUnit !== existing.costPerUnit;
      const yieldChanged = v.preparationYield !== undefined
        && v.preparationYield !== existing.preparationYield;

      if (costChanged && existing.isPreparation === false) {
        // Atomic ingredient cost change ripples to dependent preps.
        await cascadeCostUpdate(
          tx,
          session.user.outletId,
          id,
          session.user.id,
        );
      } else if (yieldChanged && existing.isPreparation === true) {
        // Yield change re-derives this prep's own cost; cascade from there.
        await cascadeCostUpdate(
          tx,
          session.user.outletId,
          id,
          session.user.id,
        );
      }

      // Sesi AA: when unit changes mid-opname, also update the snapshot label
      // di stock_opname_lines untuk sesi yang masih in_progress (belum
      // finalized → belum jadi audit record). Pre-fix: snapshot frozen on
      // start, jadi staff edit unit di Inventory tetap lihat unit lama di
      // opname row → bingung. Schema unique idx ux_opname_sessions_active_per_outlet
      // menjamin maks 1 in_progress per outlet, jadi single subquery cukup.
      if (v.unit !== undefined && v.unit !== existing.unit) {
        const [active] = await tx
          .select({ id: stockOpnameSessions.id })
          .from(stockOpnameSessions)
          .where(
            and(
              eq(stockOpnameSessions.outletId, session.user.outletId),
              eq(stockOpnameSessions.status, "in_progress"),
            ),
          )
          .limit(1);
        if (active) {
          await tx
            .update(stockOpnameLines)
            .set({ unitSnapshot: v.unit })
            .where(
              and(
                eq(stockOpnameLines.sessionId, active.id),
                eq(stockOpnameLines.ingredientId, id),
              ),
            );
        }
      }

      return updated;
    });

    await logAudit({
      eventType: existing.isPreparation
        ? "inventory.preparation.update"
        : "inventory.ingredient.update",
      userId: session.user.id,
      entityType: "ingredient",
      entityId: id,
      payload: {
        summary: existing.isPreparation
          ? `Edit preparation ${result.name}`
          : `Edit bahan ${result.name}`,
        before: existing,
        after: result,
        diff: diffShallow(
          existing as unknown as Record<string, unknown>,
          result as unknown as Record<string, unknown>,
        ),
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    });

    return ok(result);
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

  // Refuse delete if any recipe references this ingredient (atomic OR prep).
  // Owner must clear dependents first.
  const [refRow] = await db
    .select({ recipeId: recipeIngredients.recipeId })
    .from(recipeIngredients)
    .where(eq(recipeIngredients.ingredientId, id))
    .limit(1);
  if (refRow) {
    return fail(
      "INGREDIENT_HAS_DEPENDENTS",
      "Bahan masih dipakai di resep aktif — hapus dulu resep yang merefer",
    );
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

    // Sesi AE-12 — write decimal mirror.
    const newStock = computeNewStock({
      currentBigint: ingRow.currentStock,
      currentDecimal: ingRow.currentStockDecimal,
      delta: opts.qtyDelta,
    });
    const movementDelta = formatMovementDelta(opts.qtyDelta);

    const [updatedIng] = await tx
      .update(ingredients)
      .set({
        currentStock: newStock.bigint,
        currentStockDecimal: newStock.decimal,
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
        qtyDelta: movementDelta.bigint,
        qtyDeltaDecimal: movementDelta.decimal,
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

      // Sesi AE-12 — write decimal mirror.
      const newStock = computeNewStock({
        currentBigint: ingRow.currentStock,
        currentDecimal: ingRow.currentStockDecimal,
        delta: v.qty,
      });
      const movementDelta = formatMovementDelta(v.qty);

      const [updatedIng] = await tx
        .update(ingredients)
        .set({
          currentStock: newStock.bigint,
          currentStockDecimal: newStock.decimal,
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
          qtyDelta: movementDelta.bigint,
          qtyDeltaDecimal: movementDelta.decimal,
          unitCostAtMovement: v.unitCost,
          referenceType: "manual",
          reason: v.note ?? null,
          createdBy: session.user.id,
        })
        .returning();

      // Cost change at receive time ripples to dependent preps. Atomic-only —
      // preps don't get "received" via this path (their cost is derived).
      if (
        v.updateCost
        && v.unitCost !== ingRow.costPerUnit
        && ingRow.isPreparation === false
      ) {
        await cascadeCostUpdate(
          tx,
          session.user.outletId,
          v.ingredientId,
          session.user.id,
        );
      }

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
    return fail("DB_ERROR", logAndSanitize(e, "inventory", "Operasi database gagal"));
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
    return fail("DB_ERROR", logAndSanitize(e, "inventory", "Operasi database gagal"));
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
      // Sesi AE-62g — pakai decimal-aware resolve. Bigint bisa salah
      // representation kalau stock decimal mirror sudah negative (oversold
      // sebelum opname). Tanpa fix ini: ingRow.currentStock=0 (clamped),
      // currentStockDecimal="-5.0000" → check 0 < qty passes → waste applied
      // → stock makin minus. resolveStockDecimal prefer decimal.
      const liveStock = resolveStockDecimal(
        ingRow.currentStock,
        ingRow.currentStockDecimal,
      );
      if (liveStock < v.qty) {
        throw new Error("INSUFFICIENT_STOCK");
      }

      // Sesi AE-12 — decimal mirror.
      const newStock = computeNewStock({
        currentBigint: ingRow.currentStock,
        currentDecimal: ingRow.currentStockDecimal,
        delta: -v.qty,
      });
      const movementDelta = formatMovementDelta(-v.qty);

      const [updatedIng] = await tx
        .update(ingredients)
        .set({
          currentStock: newStock.bigint,
          currentStockDecimal: newStock.decimal,
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
          qtyDelta: movementDelta.bigint,
          qtyDeltaDecimal: movementDelta.decimal,
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
    return fail("DB_ERROR", logAndSanitize(e, "inventory", "Operasi database gagal"));
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
  const isPrepTarget = !!v.ingredientId;

  // Verify ingredients belong to outlet (shared across both branches).
  const ingredientCheck = await verifyIngredientsBelongToOutlet(
    session.user.outletId,
    v.ingredients,
  );
  if (ingredientCheck) return ingredientCheck;

  // ----- Branch A: menu target -----
  if (!isPrepTarget) {
    const menuItemId = v.menuItemId!;
    const menu = await loadMenuItemForRecipe(menuItemId);
    if (!menu || menu.outletId !== session.user.outletId) {
      return fail("MENU_ITEM_NOT_FOUND", "Menu item tidak ditemukan");
    }
    const variantCheck = validateVariantAgainstMenuItem(menu, v.variant);
    if (variantCheck) return variantCheck;

    try {
      const created = await db.transaction(async (tx) => {
        const [recipe] = await tx
          .insert(recipes)
          .values({
            outletId: session.user.outletId,
            menuItemId,
            variant: v.variant ?? null,
            notes: v.notes ?? null,
            wasteFactorPct: v.wasteFactorPct ?? 30,
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

  // ----- Branch B: prep target -----
  const targetIngredientId = v.ingredientId!;
  const target = await fetchIngredientById(targetIngredientId);
  if (!target || target.outletId !== session.user.outletId) {
    return fail("INGREDIENT_NOT_FOUND", "Ingredient target tidak ditemukan");
  }
  if (!target.isPreparation) {
    return fail(
      "TARGET_NOT_PREPARATION",
      "Ingredient target bukan preparation",
    );
  }

  try {
    const created = await db.transaction(async (tx) => {
      // Cycle detection BEFORE write.
      const proposedIds = v.ingredients.map((l) => l.ingredientId);
      const hasCycle = await detectCycleForRecipeUpsert(
        tx,
        session.user.outletId,
        targetIngredientId,
        proposedIds,
        null,
      );
      if (hasCycle) throw new Error("RECIPE_CYCLE");

      const [recipe] = await tx
        .insert(recipes)
        .values({
          outletId: session.user.outletId,
          ingredientId: targetIngredientId,
          variant: null, // D5: no variant on prep recipes
          notes: v.notes ?? null,
          wasteFactorPct: v.wasteFactorPct ?? 10,
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

      // New prep recipe → recompute prep cost + cascade to anything depending
      // on this prep (none yet at create-time, but defensive).
      await cascadeCostUpdate(
        tx,
        session.user.outletId,
        targetIngredientId,
        session.user.id,
      );

      return recipe;
    });

    const full = await fetchRecipeById(created.id);
    if (!full) return fail("DB_ERROR", "Gagal load resep setelah create");

    await logAudit({
      eventType: "inventory.preparation.create",
      userId: session.user.id,
      entityType: "recipe",
      entityId: created.id,
      payload: {
        summary: `Tambah resep preparation ${target.name} — ${v.ingredients.length} bahan`,
        after: full,
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    });

    return ok(full);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    if (msg === "RECIPE_CYCLE") {
      return fail("RECIPE_CYCLE", "Resep akan membentuk siklus dependensi");
    }
    if (/unique|duplicate/i.test(msg)) {
      return fail(
        "DUPLICATE_RECIPE",
        "Preparation ini sudah punya resep",
      );
    }
    return fail("DB_ERROR", logAndSanitize(e, "inventory", "Operasi database gagal"));
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
  // Preparation recipes (existing.menuItemId IS NULL) don't have variants
  // (per Decision D5), so skip variant checks for them.
  if (
    v.variant !== undefined &&
    v.variant !== existing.variant &&
    existing.menuItemId !== null
  ) {
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

  const isPrepRecipe = existing.ingredientId !== null;
  // D5: prep recipes can't have variants. Prevent setting one.
  if (isPrepRecipe && v.variant !== undefined && v.variant !== null) {
    return fail(
      "VALIDATION_ERROR",
      "Preparation tidak boleh punya variant (D5)",
    );
  }

  try {
    await db.transaction(async (tx) => {
      // Cycle detection if ingredients changed on a prep recipe.
      if (isPrepRecipe && v.ingredients && existing.ingredientId) {
        const proposedIds = v.ingredients.map((l) => l.ingredientId);
        const hasCycle = await detectCycleForRecipeUpsert(
          tx,
          session.user.outletId,
          existing.ingredientId,
          proposedIds,
          id,
        );
        if (hasCycle) throw new Error("RECIPE_CYCLE");
      }

      const setRecipe: Record<string, unknown> = {
        updatedAt: new Date(),
        updatedBy: session.user.id,
      };
      if (v.variant !== undefined) setRecipe.variant = v.variant ?? null;
      if (v.notes !== undefined) setRecipe.notes = v.notes ?? null;
      if (v.wasteFactorPct !== undefined) {
        setRecipe.wasteFactorPct = v.wasteFactorPct;
      }

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

      // Recompute prep cost if any cost-relevant field changed.
      if (isPrepRecipe && existing.ingredientId) {
        const wasteChanged = v.wasteFactorPct !== undefined
          && v.wasteFactorPct !== existing.wasteFactorPct;
        if (v.ingredients || wasteChanged) {
          await cascadeCostUpdate(
            tx,
            session.user.outletId,
            existing.ingredientId,
            session.user.id,
          );
        }
      }
    });

    const updated = await fetchRecipeById(id);
    if (!updated) return fail("DB_ERROR", "Gagal load resep setelah update");

    await logAudit({
      eventType: isPrepRecipe
        ? "inventory.preparation.update"
        : "inventory.recipe.update",
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
    const msg = e instanceof Error ? e.message : "Database error";
    if (msg === "RECIPE_CYCLE") {
      return fail("RECIPE_CYCLE", "Resep akan membentuk siklus dependensi");
    }
    if (/unique|duplicate/i.test(msg)) {
      return fail(
        "DUPLICATE_RECIPE",
        "Resep untuk menu+variant ini sudah ada",
      );
    }
    return fail("DB_ERROR", logAndSanitize(e, "inventory", "Operasi database gagal"));
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

  // For preparation recipes, refuse delete if other recipes reference the
  // prep ingredient. Owner must clear dependents first.
  if (existing.ingredientId !== null) {
    const [depRow] = await db
      .select({ recipeId: recipeIngredients.recipeId })
      .from(recipeIngredients)
      .where(eq(recipeIngredients.ingredientId, existing.ingredientId))
      .limit(1);
    if (depRow) {
      return fail(
        "PREP_HAS_DEPENDENTS",
        "Preparation masih dipakai di resep lain — hapus dulu yang merefer",
      );
    }
  }

  // Hard delete; recipe_ingredients cascade.
  await db.delete(recipes).where(eq(recipes.id, id));

  await logAudit({
    eventType: existing.ingredientId !== null
      ? "inventory.preparation.delete"
      : "inventory.recipe.delete",
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

// ---------- Section bulk-assign (Sesi O) ----------

export async function bulkAssignSection(
  input: BulkAssignSectionInput,
): Promise<ApiResult<{ updated: number }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.section.bulk_assign")) {
    return fail(
      "FORBIDDEN",
      "Hanya manager / owner yang boleh bulk-assign section",
    );
  }
  const parsed = bulkAssignSectionSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;

  try {
    const updated = await db.transaction(async (tx) => {
      const rows = await tx
        .update(ingredients)
        .set({
          section: v.section,
          updatedAt: new Date(),
          updatedBy: session.user.id,
        })
        .where(
          and(
            eq(ingredients.outletId, session.user.outletId),
            inArray(ingredients.id, v.ingredientIds),
            isNull(ingredients.deletedAt),
          ),
        )
        .returning({ id: ingredients.id });
      return rows.length;
    });

    await logAudit({
      eventType: "inventory.section.bulk_assign",
      userId: session.user.id,
      entityType: "ingredient",
      entityId: null,
      payload: {
        summary: `Bulk-assign section ${v.section ?? "unassigned"} untuk ${updated} bahan`,
        context: {
          ingredientIds: v.ingredientIds,
          section: v.section,
          updated,
        },
      },
      metadata: {
        outletId: session.user.outletId,
        actorRole: session.user.role,
      },
    });

    return ok({ updated });
  } catch (e) {
    return fail(
      "DB_ERROR",
      e instanceof Error ? e.message : "Database error",
    );
  }
}
