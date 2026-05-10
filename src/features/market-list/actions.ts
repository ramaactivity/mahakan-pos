"use server";

import { and, asc, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  ingredients,
  suppliers,
  supplierIngredients,
  auditLogs,
} from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { cascadeCostUpdate } from "@/features/inventory/preparation-flow";
import { resolveUnit } from "@/lib/unit-conversion";
import {
  bulkImportSchema,
  createMarketItemSchema,
  updateMarketItemSchema,
} from "./schemas";
import {
  fail,
  ok,
  type ApiResult,
  type BulkImportResult,
  type CreateMarketItemInput,
  type ListMarketItemsOptions,
  type MarketListItem,
  type UpdateMarketItemInput,
} from "./types";

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

/** Convert pack-level cost ke ingredient-master-unit cost.
 *  Mis. unitCost=36000 (Rp/pack), packSize=1000, packUnit="gr",
 *  ingredient.unit="gr" → effective=36 (Rp/gr).
 *  Kalau dimensi compatible (Kg→gr), convert via resolveUnit factor. */
function computeEffectiveCost(
  unitCost: number,
  packSize: number,
  packUnit: string,
  ingredientUnit: string,
): number | null {
  if (packUnit === ingredientUnit) {
    if (packSize === 0) return null;
    return Math.round(unitCost / packSize);
  }
  const packMeta = resolveUnit(packUnit);
  const ingMeta = resolveUnit(ingredientUnit);
  if (!packMeta || !ingMeta) return null;
  if (packMeta.dimension !== ingMeta.dimension) return null;
  if (packMeta.dimension === "discrete") return null;
  // packSize × packMeta.toBase = qty in base unit; / ingMeta.toBase = qty in ingredient unit
  const qtyInIngredientUnit =
    (packSize * packMeta.toBase) / ingMeta.toBase;
  if (qtyInIngredientUnit === 0) return null;
  return Math.round(unitCost / qtyInIngredientUnit);
}

/** List market items joined dengan supplier + ingredient meta. */
export async function listMarketItems(
  opts: ListMarketItemsOptions = {},
): Promise<ApiResult<MarketListItem[]>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "market_list.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat market list");
  }

  const filters = [
    eq(supplierIngredients.outletId, session.user.outletId),
    isNull(supplierIngredients.deletedAt),
  ];
  if (opts.supplierId) {
    filters.push(eq(supplierIngredients.supplierId, opts.supplierId));
  }
  if (opts.primaryOnly) {
    filters.push(eq(supplierIngredients.isPrimary, true));
  }
  if (opts.search && opts.search.trim().length > 0) {
    const term = `%${opts.search.trim()}%`;
    const searchFilter = or(
      ilike(ingredients.name, term),
      ilike(suppliers.name, term),
    );
    if (searchFilter) filters.push(searchFilter);
  }

  const rows = await db
    .select({
      id: supplierIngredients.id,
      outletId: supplierIngredients.outletId,
      supplierId: supplierIngredients.supplierId,
      supplierName: suppliers.name,
      supplierContact: suppliers.contact,
      ingredientId: supplierIngredients.ingredientId,
      ingredientName: ingredients.name,
      ingredientUnit: ingredients.unit,
      ingredientSection: ingredients.section,
      unitCost: supplierIngredients.unitCost,
      packSize: supplierIngredients.packSize,
      packUnit: supplierIngredients.packUnit,
      isPrimary: supplierIngredients.isPrimary,
      notes: supplierIngredients.notes,
      updatedAt: supplierIngredients.updatedAt,
    })
    .from(supplierIngredients)
    .innerJoin(suppliers, eq(supplierIngredients.supplierId, suppliers.id))
    .innerJoin(
      ingredients,
      eq(supplierIngredients.ingredientId, ingredients.id),
    )
    .where(and(...filters))
    .orderBy(
      asc(ingredients.name),
      desc(supplierIngredients.isPrimary),
      asc(suppliers.name),
    );

  const items: MarketListItem[] = rows.map((r) => {
    const packSizeNum = parseFloat(r.packSize);
    return {
      id: r.id,
      outletId: r.outletId,
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      supplierContact: r.supplierContact,
      ingredientId: r.ingredientId,
      ingredientName: r.ingredientName,
      ingredientUnit: r.ingredientUnit,
      ingredientSection: r.ingredientSection,
      unitCost: r.unitCost,
      packSize: packSizeNum,
      packUnit: r.packUnit,
      effectiveCostPerUnit:
        computeEffectiveCost(
          r.unitCost,
          packSizeNum,
          r.packUnit,
          r.ingredientUnit,
        ) ?? 0,
      isPrimary: r.isPrimary,
      notes: r.notes,
      updatedAt: r.updatedAt.toISOString(),
      priceLastChangedAt: r.updatedAt.toISOString(),
    };
  });

  return ok(items);
}

/** Untuk Catat Pembelian auto-fill: cari market entry by (supplier, ingredient). */
export async function lookupMarketPriceForPurchase(input: {
  supplierId: string;
  ingredientId: string;
}): Promise<
  ApiResult<{
    unitCost: number;
    packSize: number;
    packUnit: string;
    effectiveCostPerUnit: number;
    ingredientUnit: string;
  } | null>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "market_list.view")) {
    return fail("FORBIDDEN", "Tidak punya hak akses market list");
  }
  const [row] = await db
    .select({
      unitCost: supplierIngredients.unitCost,
      packSize: supplierIngredients.packSize,
      packUnit: supplierIngredients.packUnit,
      ingredientUnit: ingredients.unit,
    })
    .from(supplierIngredients)
    .innerJoin(
      ingredients,
      eq(supplierIngredients.ingredientId, ingredients.id),
    )
    .where(
      and(
        eq(supplierIngredients.outletId, session.user.outletId),
        eq(supplierIngredients.supplierId, input.supplierId),
        eq(supplierIngredients.ingredientId, input.ingredientId),
        isNull(supplierIngredients.deletedAt),
      ),
    )
    .limit(1);

  if (!row) return ok(null);
  const packSizeNum = parseFloat(row.packSize);
  return ok({
    unitCost: row.unitCost,
    packSize: packSizeNum,
    packUnit: row.packUnit,
    effectiveCostPerUnit:
      computeEffectiveCost(
        row.unitCost,
        packSizeNum,
        row.packUnit,
        row.ingredientUnit,
      ) ?? 0,
    ingredientUnit: row.ingredientUnit,
  });
}

/** Create market item. Kalau isPrimary=true:
 *   - Demote primary lain di (outlet, ingredient) yang sama
 *   - Update ingredients.cost_per_unit + cascade
 */
export async function createMarketItem(
  input: CreateMarketItemInput,
): Promise<ApiResult<MarketListItem>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "market_list.create")) {
    return fail("FORBIDDEN", "Tidak punya hak buat market item");
  }
  const parse = createMarketItemSchema.safeParse(input);
  if (!parse.success) {
    const first = parse.error.issues[0];
    return fail(
      "VALIDATION_ERROR",
      first?.message ?? "Input tidak valid",
      String(first?.path[0] ?? ""),
    );
  }
  const v = parse.data;

  // Validasi supplier + ingredient milik outlet ini.
  const [supRow] = await db
    .select({ id: suppliers.id, deletedAt: suppliers.deletedAt })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.id, v.supplierId),
        eq(suppliers.outletId, session.user.outletId),
      ),
    )
    .limit(1);
  if (!supRow || supRow.deletedAt) {
    return fail("NOT_FOUND", "Supplier tidak ditemukan", "supplierId");
  }
  const [ingRow] = await db
    .select({
      id: ingredients.id,
      unit: ingredients.unit,
      isPreparation: ingredients.isPreparation,
      deletedAt: ingredients.deletedAt,
    })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.id, v.ingredientId),
        eq(ingredients.outletId, session.user.outletId),
      ),
    )
    .limit(1);
  if (!ingRow || ingRow.deletedAt) {
    return fail("NOT_FOUND", "Bahan tidak ditemukan", "ingredientId");
  }
  if (ingRow.isPreparation) {
    return fail(
      "VALIDATION_ERROR",
      "Preparation cost di-derived dari recipe, tidak bisa di-set via market list",
      "ingredientId",
    );
  }

  // Cek konversi unit valid (kalau staff pilih unit beda dari master).
  const effective = computeEffectiveCost(
    v.unitCost,
    v.packSize,
    v.packUnit,
    ingRow.unit,
  );
  if (effective === null) {
    return fail(
      "VALIDATION_ERROR",
      `Tidak bisa convert ${v.packUnit} ke ${ingRow.unit} (dimensi beda atau unknown unit)`,
      "packUnit",
    );
  }

  const now = new Date();
  const result = await db.transaction(async (tx) => {
    // Cek duplikat (supplier × ingredient) — soft-delete aware.
    const [dup] = await tx
      .select({ id: supplierIngredients.id })
      .from(supplierIngredients)
      .where(
        and(
          eq(supplierIngredients.outletId, session.user.outletId),
          eq(supplierIngredients.supplierId, v.supplierId),
          eq(supplierIngredients.ingredientId, v.ingredientId),
          isNull(supplierIngredients.deletedAt),
        ),
      )
      .limit(1);
    if (dup) {
      throw new DuplicateError(
        "Supplier ini sudah punya entry untuk bahan tsb. Edit existing entry instead.",
      );
    }

    // Demote existing primary kalau new entry primary.
    if (v.isPrimary) {
      await tx
        .update(supplierIngredients)
        .set({ isPrimary: false, updatedAt: now })
        .where(
          and(
            eq(supplierIngredients.outletId, session.user.outletId),
            eq(supplierIngredients.ingredientId, v.ingredientId),
            eq(supplierIngredients.isPrimary, true),
            isNull(supplierIngredients.deletedAt),
          ),
        );
    }

    const [inserted] = await tx
      .insert(supplierIngredients)
      .values({
        outletId: session.user.outletId,
        supplierId: v.supplierId,
        ingredientId: v.ingredientId,
        unitCost: v.unitCost,
        packSize: String(v.packSize),
        packUnit: v.packUnit,
        isPrimary: v.isPrimary,
        notes: v.notes ?? null,
        createdBy: session.user.id,
        updatedBy: session.user.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (v.isPrimary) {
      await tx
        .update(ingredients)
        .set({
          costPerUnit: effective,
          costLastChangedAt: now,
          updatedAt: now,
          updatedBy: session.user.id,
        })
        .where(eq(ingredients.id, v.ingredientId));
      await cascadeCostUpdate(
        tx,
        session.user.outletId,
        v.ingredientId,
        session.user.id,
      );
    }

    await tx.insert(auditLogs).values({
      eventType: "market_list.create",
      userId: session.user.id,
      entityType: "supplier_ingredients",
      entityId: inserted!.id,
      payload: {
        supplierId: v.supplierId,
        ingredientId: v.ingredientId,
        unitCost: v.unitCost,
        packSize: v.packSize,
        packUnit: v.packUnit,
        isPrimary: v.isPrimary,
        effectiveCostPerUnit: effective,
      },
    });

    return inserted!;
  }).catch((e: unknown) => {
    if (e instanceof DuplicateError) return { __duplicate: e.message };
    throw e;
  });

  if ("__duplicate" in (result as { __duplicate?: string })) {
    return fail("CONFLICT", (result as { __duplicate: string }).__duplicate);
  }
  // Re-fetch with joined meta.
  const detailed = await listMarketItems({});
  if (!detailed.success) return detailed;
  const found = detailed.data.find(
    (m) => m.id === (result as { id: string }).id,
  );
  if (!found) return fail("NOT_FOUND", "Item baru tidak ditemukan");
  return ok(found);
}

class DuplicateError extends Error {}

export async function updateMarketItem(input: {
  id: string;
  patch: UpdateMarketItemInput;
}): Promise<ApiResult<MarketListItem>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "market_list.update")) {
    return fail("FORBIDDEN", "Tidak punya hak update market item");
  }
  const parse = updateMarketItemSchema.safeParse(input.patch);
  if (!parse.success) {
    const first = parse.error.issues[0];
    return fail(
      "VALIDATION_ERROR",
      first?.message ?? "Input tidak valid",
      String(first?.path[0] ?? ""),
    );
  }
  const v = parse.data;
  const now = new Date();

  const updateRes = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(supplierIngredients)
      .where(
        and(
          eq(supplierIngredients.id, input.id),
          eq(supplierIngredients.outletId, session.user.outletId),
          isNull(supplierIngredients.deletedAt),
        ),
      )
      .limit(1);
    if (!existing) return { __notFound: true } as const;

    const [ingRow] = await tx
      .select({ unit: ingredients.unit, isPreparation: ingredients.isPreparation })
      .from(ingredients)
      .where(eq(ingredients.id, existing.ingredientId))
      .limit(1);
    if (!ingRow) return { __notFound: true } as const;
    if (ingRow.isPreparation) {
      return {
        __validation:
          "Preparation cost di-derived dari recipe, tidak bisa diubah via market list",
      } as const;
    }

    const newUnitCost = v.unitCost ?? existing.unitCost;
    const newPackSize =
      v.packSize !== undefined ? v.packSize : parseFloat(existing.packSize);
    const newPackUnit = v.packUnit ?? existing.packUnit;
    const newIsPrimary =
      v.isPrimary !== undefined ? v.isPrimary : existing.isPrimary;

    const effective = computeEffectiveCost(
      newUnitCost,
      newPackSize,
      newPackUnit,
      ingRow.unit,
    );
    if (effective === null) {
      return {
        __validation: `Tidak bisa convert ${newPackUnit} ke ${ingRow.unit}`,
      } as const;
    }

    // Demote primary lain di (outlet, ingredient) kalau toggle ke primary.
    if (newIsPrimary && !existing.isPrimary) {
      await tx
        .update(supplierIngredients)
        .set({ isPrimary: false, updatedAt: now })
        .where(
          and(
            eq(supplierIngredients.outletId, session.user.outletId),
            eq(supplierIngredients.ingredientId, existing.ingredientId),
            eq(supplierIngredients.isPrimary, true),
            isNull(supplierIngredients.deletedAt),
          ),
        );
    }

    const [updated] = await tx
      .update(supplierIngredients)
      .set({
        unitCost: newUnitCost,
        packSize: String(newPackSize),
        packUnit: newPackUnit,
        isPrimary: newIsPrimary,
        notes: v.notes !== undefined ? v.notes : existing.notes,
        updatedAt: now,
        updatedBy: session.user.id,
      })
      .where(eq(supplierIngredients.id, input.id))
      .returning();

    // Cascade kalau is_primary (sebelumnya OR sekarang) DAN price-affecting field changed.
    const priceChanged =
      newUnitCost !== existing.unitCost ||
      newPackSize !== parseFloat(existing.packSize) ||
      newPackUnit !== existing.packUnit ||
      newIsPrimary !== existing.isPrimary;
    if (priceChanged && newIsPrimary) {
      await tx
        .update(ingredients)
        .set({
          costPerUnit: effective,
          costLastChangedAt: now,
          updatedAt: now,
          updatedBy: session.user.id,
        })
        .where(eq(ingredients.id, existing.ingredientId));
      await cascadeCostUpdate(
        tx,
        session.user.outletId,
        existing.ingredientId,
        session.user.id,
      );
    }

    await tx.insert(auditLogs).values({
      eventType: "market_list.update",
      userId: session.user.id,
      entityType: "supplier_ingredients",
      entityId: existing.id,
      payload: {
        before: {
          unitCost: existing.unitCost,
          packSize: existing.packSize,
          packUnit: existing.packUnit,
          isPrimary: existing.isPrimary,
        },
        after: {
          unitCost: newUnitCost,
          packSize: newPackSize,
          packUnit: newPackUnit,
          isPrimary: newIsPrimary,
        },
        effectiveCostPerUnit: effective,
        cascaded: priceChanged && newIsPrimary,
      },
    });

    return { __updated: updated! } as const;
  });

  if ("__notFound" in updateRes) {
    return fail("NOT_FOUND", "Market item tidak ditemukan");
  }
  if ("__validation" in updateRes && updateRes.__validation) {
    return fail("VALIDATION_ERROR", updateRes.__validation);
  }

  const detailed = await listMarketItems({});
  if (!detailed.success) return detailed;
  const found = detailed.data.find((m) => m.id === input.id);
  if (!found) return fail("NOT_FOUND", "Item tidak ditemukan setelah update");
  return ok(found);
}

export async function deleteMarketItem(input: {
  id: string;
}): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "market_list.delete")) {
    return fail("FORBIDDEN", "Tidak punya hak hapus market item");
  }
  const now = new Date();
  const [updated] = await db
    .update(supplierIngredients)
    .set({
      deletedAt: now,
      updatedAt: now,
      updatedBy: session.user.id,
    })
    .where(
      and(
        eq(supplierIngredients.id, input.id),
        eq(supplierIngredients.outletId, session.user.outletId),
        isNull(supplierIngredients.deletedAt),
      ),
    )
    .returning({ id: supplierIngredients.id });

  if (!updated) return fail("NOT_FOUND", "Market item tidak ditemukan");

  await db.insert(auditLogs).values({
    eventType: "market_list.delete",
    userId: session.user.id,
    entityType: "supplier_ingredients",
    entityId: input.id,
    payload: { id: input.id },
  });

  return ok({ id: input.id });
}

/** Bulk import dari CSV. Match supplier + ingredient by name (case-insensitive).
 *  Existing entry → update; new → insert. Kalau name tidak match, skip + report
 *  ke errors. Cascade dijalankan untuk semua primary updates di akhir batch. */
export async function bulkImportMarketList(input: {
  rows: Array<{
    supplierName: string;
    ingredientName: string;
    unitCost: number;
    packSize: number;
    packUnit: string;
    isPrimary?: boolean;
    notes?: string | null;
  }>;
}): Promise<ApiResult<BulkImportResult>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "market_list.create")) {
    return fail("FORBIDDEN", "Tidak punya hak import market list");
  }
  const parse = bulkImportSchema.safeParse(input);
  if (!parse.success) {
    const first = parse.error.issues[0];
    return fail("VALIDATION_ERROR", first?.message ?? "Input tidak valid");
  }

  const supplierRows = await db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.outletId, session.user.outletId),
        isNull(suppliers.deletedAt),
      ),
    );
  const ingredientRows = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      unit: ingredients.unit,
      isPreparation: ingredients.isPreparation,
    })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.outletId, session.user.outletId),
        isNull(ingredients.deletedAt),
      ),
    );

  const supplierByName = new Map(
    supplierRows.map((s) => [s.name.toLowerCase(), s]),
  );
  const ingredientByName = new Map(
    ingredientRows.map((i) => [i.name.toLowerCase(), i]),
  );

  const result: BulkImportResult = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };
  const cascadeIngredientIds = new Set<string>();
  const now = new Date();

  await db.transaction(async (tx) => {
    for (let idx = 0; idx < parse.data.rows.length; idx++) {
      const row = parse.data.rows[idx]!;
      const supplier = supplierByName.get(row.supplierName.toLowerCase());
      const ingredient = ingredientByName.get(
        row.ingredientName.toLowerCase(),
      );
      if (!supplier) {
        result.errors.push({
          row: idx + 1,
          message: `Supplier "${row.supplierName}" tidak ditemukan`,
        });
        result.skipped++;
        continue;
      }
      if (!ingredient) {
        result.errors.push({
          row: idx + 1,
          message: `Bahan "${row.ingredientName}" tidak ditemukan`,
        });
        result.skipped++;
        continue;
      }
      if (ingredient.isPreparation) {
        result.errors.push({
          row: idx + 1,
          message: `Bahan "${row.ingredientName}" adalah preparation — di-derived dari recipe`,
        });
        result.skipped++;
        continue;
      }
      const effective = computeEffectiveCost(
        row.unitCost,
        row.packSize,
        row.packUnit,
        ingredient.unit,
      );
      if (effective === null) {
        result.errors.push({
          row: idx + 1,
          message: `Tidak bisa convert ${row.packUnit} ke ${ingredient.unit}`,
        });
        result.skipped++;
        continue;
      }

      const [existing] = await tx
        .select()
        .from(supplierIngredients)
        .where(
          and(
            eq(supplierIngredients.outletId, session.user.outletId),
            eq(supplierIngredients.supplierId, supplier.id),
            eq(supplierIngredients.ingredientId, ingredient.id),
            isNull(supplierIngredients.deletedAt),
          ),
        )
        .limit(1);

      if (row.isPrimary) {
        await tx
          .update(supplierIngredients)
          .set({ isPrimary: false, updatedAt: now })
          .where(
            and(
              eq(supplierIngredients.outletId, session.user.outletId),
              eq(supplierIngredients.ingredientId, ingredient.id),
              eq(supplierIngredients.isPrimary, true),
              isNull(supplierIngredients.deletedAt),
            ),
          );
      }

      if (existing) {
        await tx
          .update(supplierIngredients)
          .set({
            unitCost: row.unitCost,
            packSize: String(row.packSize),
            packUnit: row.packUnit,
            isPrimary: row.isPrimary ?? existing.isPrimary,
            notes: row.notes !== undefined ? row.notes : existing.notes,
            updatedAt: now,
            updatedBy: session.user.id,
          })
          .where(eq(supplierIngredients.id, existing.id));
        result.updated++;
      } else {
        await tx.insert(supplierIngredients).values({
          outletId: session.user.outletId,
          supplierId: supplier.id,
          ingredientId: ingredient.id,
          unitCost: row.unitCost,
          packSize: String(row.packSize),
          packUnit: row.packUnit,
          isPrimary: row.isPrimary ?? false,
          notes: row.notes ?? null,
          createdBy: session.user.id,
          updatedBy: session.user.id,
          createdAt: now,
          updatedAt: now,
        });
        result.inserted++;
      }

      if (row.isPrimary) {
        await tx
          .update(ingredients)
          .set({
            costPerUnit: effective,
            costLastChangedAt: now,
            updatedAt: now,
            updatedBy: session.user.id,
          })
          .where(eq(ingredients.id, ingredient.id));
        cascadeIngredientIds.add(ingredient.id);
      }
    }

    // Cascade per-ingredient setelah semua write selesai (avoid intra-loop lock contention).
    for (const ingId of cascadeIngredientIds) {
      await cascadeCostUpdate(
        tx,
        session.user.outletId,
        ingId,
        session.user.id,
      );
    }

    await tx.insert(auditLogs).values({
      eventType: "market_list.bulk_import",
      userId: session.user.id,
      entityType: "supplier_ingredients",
      payload: {
        inserted: result.inserted,
        updated: result.updated,
        skipped: result.skipped,
        errorCount: result.errors.length,
      },
    });
  });

  return ok(result);
}
