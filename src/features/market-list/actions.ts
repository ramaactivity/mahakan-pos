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
import {
  resolveQtyToMaster,
  type IngredientPackConversion,
} from "@/lib/unit-conversion";
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

/** Sesi AE-174 — konteks satuan ingredient untuk resolusi cost. */
interface IngredientUnitContext {
  unit: string;
  packConversions: IngredientPackConversion[] | null;
  unitBelanja: string | null;
  unitBelanjaPerCogs: number | string | null;
}

/** Bangun konteks dari baris SELECT (packConversions jsonb di-cast). */
function ingContext(row: {
  ingredientUnit: string;
  ingredientPackConversions?: unknown;
  ingredientPurchaseUnit?: string | null;
  ingredientPurchasePerRecipe?: number | string | null;
}): IngredientUnitContext {
  return {
    unit: row.ingredientUnit,
    packConversions:
      (row.ingredientPackConversions as IngredientPackConversion[] | null) ??
      null,
    unitBelanja: row.ingredientPurchaseUnit ?? null,
    unitBelanjaPerCogs: row.ingredientPurchasePerRecipe ?? null,
  };
}

/** Convert pack-level cost ke ingredient-master-unit cost — SUMBER TUNGGAL.
 *  Mis. unitCost=21000 (Rp/renceng), packSize=1, packUnit="renceng",
 *  ingredient.unit="gr" + packConversions[renceng=280] → effective=75 (Rp/gr).
 *  Konsisten dgn Opname & Pembelian via resolveQtyToMaster. */
function computeEffectiveCost(
  unitCost: number,
  packSize: number,
  packUnit: string,
  ing: IngredientUnitContext,
): number | null {
  const r = resolveQtyToMaster({
    qty: packSize,
    fromUnit: packUnit,
    masterUnit: ing.unit,
    ingredientPacks: ing.packConversions,
    unitBelanja: ing.unitBelanja,
    unitBelanjaPerCogs: ing.unitBelanjaPerCogs,
  });
  if (!r.ok || r.qtyMaster === null || r.qtyMaster === 0) return null;
  return Math.round(unitCost / r.qtyMaster);
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
      /* Sesi AE-136 — surface purchase unit + ratio untuk display. */
      ingredientPurchaseUnit: ingredients.unitBelanja,
      ingredientPurchasePerRecipe: ingredients.unitBelanjaPerCogs,
      ingredientPackConversions: ingredients.packConversions,
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
      ingredientPurchaseUnit: r.ingredientPurchaseUnit?.trim() || null,
      ingredientPurchasePerRecipe: r.ingredientPurchasePerRecipe
        ? parseFloat(r.ingredientPurchasePerRecipe)
        : null,
      ingredientSection: r.ingredientSection,
      unitCost: r.unitCost,
      packSize: packSizeNum,
      packUnit: r.packUnit,
      effectiveCostPerUnit:
        computeEffectiveCost(
          r.unitCost,
          packSizeNum,
          r.packUnit,
          ingContext(r),
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
      ingredientPurchaseUnit: ingredients.unitBelanja,
      ingredientPurchasePerRecipe: ingredients.unitBelanjaPerCogs,
      ingredientPackConversions: ingredients.packConversions,
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
        ingContext(row),
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
      ingredientUnit: ingredients.unit,
      isPreparation: ingredients.isPreparation,
      deletedAt: ingredients.deletedAt,
      ingredientPurchaseUnit: ingredients.unitBelanja,
      ingredientPurchasePerRecipe: ingredients.unitBelanjaPerCogs,
      ingredientPackConversions: ingredients.packConversions,
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
    ingContext(ingRow),
  );
  if (effective === null) {
    return fail(
      "VALIDATION_ERROR",
      `Tidak bisa convert ${v.packUnit} ke ${ingRow.ingredientUnit}. Set "Konversi Pack" di Edit Satuan Bahan, atau pilih satuan se-dimensi.`,
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

    /* Sesi AE-39 — staff bisa ganti supplier / bahan langsung dari edit
     * modal. Validate target keberadaan + cek duplikat (supplier × bahan)
     * baru, lalu cascade ulang ke bahan lama (kalau sebelumnya primary)
     * + bahan baru (kalau primary). */
    const newSupplierId = v.supplierId ?? existing.supplierId;
    const newIngredientId = v.ingredientId ?? existing.ingredientId;
    const supplierChanged = newSupplierId !== existing.supplierId;
    const ingredientChanged = newIngredientId !== existing.ingredientId;

    if (supplierChanged) {
      const [supRow] = await tx
        .select({ id: suppliers.id, deletedAt: suppliers.deletedAt })
        .from(suppliers)
        .where(
          and(
            eq(suppliers.id, newSupplierId),
            eq(suppliers.outletId, session.user.outletId),
          ),
        )
        .limit(1);
      if (!supRow || supRow.deletedAt) {
        return {
          __validation: "Supplier baru tidak ditemukan / sudah dihapus",
        } as const;
      }
    }

    // Resolve target ingredient untuk dapat unit + isPreparation. Kalau
    // ingredient diganti, pakai data ingredient baru; kalau tidak,
    // pakai existing.ingredientId.
    const [ingRow] = await tx
      .select({
        id: ingredients.id,
        ingredientUnit: ingredients.unit,
        isPreparation: ingredients.isPreparation,
        deletedAt: ingredients.deletedAt,
        ingredientPurchaseUnit: ingredients.unitBelanja,
        ingredientPurchasePerRecipe: ingredients.unitBelanjaPerCogs,
        ingredientPackConversions: ingredients.packConversions,
      })
      .from(ingredients)
      .where(eq(ingredients.id, newIngredientId))
      .limit(1);
    if (!ingRow || ingRow.deletedAt) {
      return {
        __validation: ingredientChanged
          ? "Bahan baru tidak ditemukan / sudah dihapus"
          : "Bahan tidak ditemukan",
      } as const;
    }
    if (ingRow.isPreparation) {
      return {
        __validation:
          "Preparation cost di-derived dari recipe, tidak bisa diubah via market list",
      } as const;
    }

    // Dup-check: kalau supplier ATAU bahan diganti, pastikan kombinasi
    // baru belum ada (excluding self).
    if (supplierChanged || ingredientChanged) {
      const [dup] = await tx
        .select({ id: supplierIngredients.id })
        .from(supplierIngredients)
        .where(
          and(
            eq(supplierIngredients.outletId, session.user.outletId),
            eq(supplierIngredients.supplierId, newSupplierId),
            eq(supplierIngredients.ingredientId, newIngredientId),
            isNull(supplierIngredients.deletedAt),
          ),
        )
        .limit(1);
      if (dup && dup.id !== existing.id) {
        return {
          __validation:
            "Supplier + bahan ini sudah punya entry. Edit entry yang sudah ada, atau pilih kombinasi lain.",
        } as const;
      }
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
      ingContext(ingRow),
    );
    if (effective === null) {
      return {
        __validation: `Tidak bisa convert ${newPackUnit} ke ${ingRow.ingredientUnit}. Set "Konversi Pack" di Edit Satuan Bahan, atau pilih satuan se-dimensi.`,
      } as const;
    }

    // Demote primary lain di (outlet, bahan target) kalau toggle ke primary.
    if (newIsPrimary) {
      await tx
        .update(supplierIngredients)
        .set({ isPrimary: false, updatedAt: now })
        .where(
          and(
            eq(supplierIngredients.outletId, session.user.outletId),
            eq(supplierIngredients.ingredientId, newIngredientId),
            eq(supplierIngredients.isPrimary, true),
            isNull(supplierIngredients.deletedAt),
          ),
        );
    }

    const [updated] = await tx
      .update(supplierIngredients)
      .set({
        supplierId: newSupplierId,
        ingredientId: newIngredientId,
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

    // Cascade target ingredient kalau primary + harga relevant berubah.
    const priceChanged =
      newUnitCost !== existing.unitCost ||
      newPackSize !== parseFloat(existing.packSize) ||
      newPackUnit !== existing.packUnit ||
      newIsPrimary !== existing.isPrimary ||
      ingredientChanged ||
      supplierChanged;
    if (priceChanged && newIsPrimary) {
      await tx
        .update(ingredients)
        .set({
          costPerUnit: effective,
          costLastChangedAt: now,
          updatedAt: now,
          updatedBy: session.user.id,
        })
        .where(eq(ingredients.id, newIngredientId));
      await cascadeCostUpdate(
        tx,
        session.user.outletId,
        newIngredientId,
        session.user.id,
      );
    }

    /* Kalau ingredient di-swap dan entry lama adalah primary untuk
     * bahan lama, bahan lama jadi tidak punya primary. Cari fallback
     * primary di bahan lama (entry existing dengan effective cost
     * terendah), kalau tidak ada biarkan (master cost tetap nilai
     * terakhir — sesuai behaviour delete primary). */
    if (ingredientChanged && existing.isPrimary) {
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
          supplierId: existing.supplierId,
          ingredientId: existing.ingredientId,
          unitCost: existing.unitCost,
          packSize: existing.packSize,
          packUnit: existing.packUnit,
          isPrimary: existing.isPrimary,
        },
        after: {
          supplierId: newSupplierId,
          ingredientId: newIngredientId,
          unitCost: newUnitCost,
          packSize: newPackSize,
          packUnit: newPackUnit,
          isPrimary: newIsPrimary,
        },
        effectiveCostPerUnit: effective,
        cascaded: priceChanged && newIsPrimary,
        supplierChanged,
        ingredientChanged,
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

/**
 * Sesi AE-31 — bulk soft-delete semua market list di outlet.
 *
 * Use case: owner re-import CSV setelah parse error — banyak entry
 * lama dengan angka salah. Manual delete 100+ rows sangat tedious.
 *
 * Permission: market_list.delete (owner only — sensitif: bisa wipe
 * harga catalog yang sudah curated).
 *
 * Catatan: NOT mengubah ingredients.cost_per_unit yang sudah ada
 * (master cost di tab Bahan tetap). Cuma row supplier_ingredients
 * yang di-soft-delete. Owner perlu re-import / re-add untuk restore
 * primary supplier sync.
 */
export async function deleteAllMarketItems(): Promise<
  ApiResult<{ deletedCount: number }>
> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "market_list.delete")) {
    return fail("FORBIDDEN", "Tidak punya hak hapus market list");
  }
  const now = new Date();
  const updated = await db
    .update(supplierIngredients)
    .set({
      deletedAt: now,
      updatedAt: now,
      updatedBy: session.user.id,
    })
    .where(
      and(
        eq(supplierIngredients.outletId, session.user.outletId),
        isNull(supplierIngredients.deletedAt),
      ),
    )
    .returning({ id: supplierIngredients.id });

  await db.insert(auditLogs).values({
    eventType: "market_list.delete",
    userId: session.user.id,
    entityType: "supplier_ingredients",
    payload: {
      bulkDelete: true,
      deletedCount: updated.length,
    },
  });

  return ok({ deletedCount: updated.length });
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
 *  Existing entry → update; new → insert. Kalau name tidak match dan
 *  createMissing=true, auto-create supplier / ingredient (notes stamped
 *  "Auto-created from market list import" supaya owner aware). Kalau
 *  createMissing=false dan ada match yang miss, skip + report ke errors.
 *  Cascade dijalankan untuk semua primary updates di akhir batch. */
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
  createMissing?: boolean;
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
      unitBelanja: ingredients.unitBelanja,
      unitBelanjaPerCogs: ingredients.unitBelanjaPerCogs,
      packConversions: ingredients.packConversions,
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
    suppliersCreated: 0,
    ingredientsCreated: 0,
    errors: [],
  };
  const cascadeIngredientIds = new Set<string>();
  const now = new Date();
  const createMissing = parse.data.createMissing ?? false;
  const importStamp = "Auto-created saat import Market List";

  await db.transaction(async (tx) => {
    for (let idx = 0; idx < parse.data.rows.length; idx++) {
      const row = parse.data.rows[idx]!;
      let supplier = supplierByName.get(row.supplierName.toLowerCase());
      let ingredient = ingredientByName.get(
        row.ingredientName.toLowerCase(),
      );
      // Sesi AE-27 — auto-create kalau opsi createMissing aktif. Notes
      // stamped supaya owner aware ada master baru dari import flow.
      if (!supplier && createMissing) {
        const [created] = await tx
          .insert(suppliers)
          .values({
            outletId: session.user.outletId,
            name: row.supplierName,
            contact: null,
            category: null,
            defaultPaymentTermDays: 0,
            notes: importStamp,
            isActive: true,
            createdBy: session.user.id,
            updatedBy: session.user.id,
          })
          .returning({ id: suppliers.id, name: suppliers.name });
        if (created) {
          supplier = { id: created.id, name: created.name };
          supplierByName.set(created.name.toLowerCase(), supplier);
          result.suppliersCreated++;
        }
      }
      if (!ingredient && createMissing) {
        const [created] = await tx
          .insert(ingredients)
          .values({
            outletId: session.user.outletId,
            name: row.ingredientName,
            unit: row.packUnit,
            currentStock: 0,
            currentStockDecimal: "0.0000",
            costPerUnit: 0,
            notes: importStamp,
            isActive: true,
            isPreparation: false,
            createdBy: session.user.id,
            updatedBy: session.user.id,
          })
          .returning({
            id: ingredients.id,
            name: ingredients.name,
            unit: ingredients.unit,
            isPreparation: ingredients.isPreparation,
            unitBelanja: ingredients.unitBelanja,
            unitBelanjaPerCogs: ingredients.unitBelanjaPerCogs,
            packConversions: ingredients.packConversions,
          });
        if (created) {
          ingredient = {
            id: created.id,
            name: created.name,
            unit: created.unit,
            isPreparation: created.isPreparation,
            unitBelanja: created.unitBelanja,
            unitBelanjaPerCogs: created.unitBelanjaPerCogs,
            packConversions: created.packConversions,
          };
          ingredientByName.set(created.name.toLowerCase(), ingredient);
          result.ingredientsCreated++;
        }
      }
      if (!supplier) {
        result.errors.push({
          row: idx + 1,
          message: `Supplier "${row.supplierName}" tidak ditemukan${createMissing ? "" : " (centang opsi auto-create)"}`,
        });
        result.skipped++;
        continue;
      }
      if (!ingredient) {
        result.errors.push({
          row: idx + 1,
          message: `Bahan "${row.ingredientName}" tidak ditemukan${createMissing ? "" : " (centang opsi auto-create)"}`,
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
      const effective = computeEffectiveCost(row.unitCost, row.packSize, row.packUnit, {
        unit: ingredient.unit,
        packConversions:
          (ingredient.packConversions as IngredientPackConversion[] | null) ??
          null,
        unitBelanja: ingredient.unitBelanja ?? null,
        unitBelanjaPerCogs: ingredient.unitBelanjaPerCogs ?? null,
      });
      if (effective === null) {
        result.errors.push({
          row: idx + 1,
          message: `Tidak bisa convert ${row.packUnit} ke ${ingredient.unit}. Set "Konversi Pack" di Edit Satuan Bahan.`,
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
