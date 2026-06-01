"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  ingredients,
  ingredientUnits,
  supplierIngredients,
  suppliers,
} from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { cascadeCostUpdate } from "@/features/inventory/preparation-flow";
import {
  loadIngredientUnitsOne,
  syncIngredientUnits,
} from "@/features/inventory/ingredient-units";
import { resolveQtyToMaster } from "@/lib/unit-conversion";
import { fail, ok, type ApiResult } from "./types";

/**
 * Sesi AE-175 — Save terpadu untuk modal "Kelola Bahan" (1 transaksi):
 *   1. Upsert identitas ingredient (nama, satuan dasar, section, stok min).
 *   2. Satuan beli/pack → tabel `ingredient_units` (sumber tunggal) +
 *      dual-write kolom lama (unitBelanja/packConversions) supaya app lain
 *      yang masih baca kolom lama tetap konsisten.
 *   3. Harga supplier (supplier_ingredients) di-diff: create/update/soft-delete,
 *      set `ingredient_unit_id` dari satuan terdefinisi, recompute primary cost
 *      + cascadeCostUpdate.
 */

/* Sesi AE-175b — model DISATUKAN: konversi satuan didefinisikan INLINE di baris
 * harga supplier (tidak lagi terpisah dari "Satuan Belanja Utama"). */
const supplierPriceSchema = z.object({
  id: z.uuid().nullable(),
  supplierId: z.uuid(),
  /** Satuan beli (mis. "renceng" atau satuan dasar "gr"). */
  buyUnit: z.string().trim().min(1).max(20),
  /** Berapa satuan dasar per 1 buyUnit. NULL kalau buyUnit = satuan dasar (1:1). */
  buyUnitPerBase: z.number().positive().nullable(),
  /** Harga per 1 buyUnit (katalog harga, bukan total nota). */
  unitCost: z.number().int().positive(),
  isPrimary: z.boolean(),
  notes: z.string().max(500).nullable().optional(),
  deleted: z.boolean().optional(),
});

/** Satuan lain untuk opname/resep (tanpa harga supplier), mis. sachet. */
const extraUnitSchema = z.object({
  label: z.string().trim().min(1).max(20),
  qtyPerBase: z.number().positive().max(1_000_000),
});

const saveIngredientManagerSchema = z.object({
  id: z.uuid().nullable(),
  name: z.string().trim().min(1).max(120),
  unit: z.string().trim().min(1).max(20),
  section: z
    .enum(["kitchen", "bar", "supporting", "cleaning"])
    .nullable(),
  reorderThreshold: z.number().nonnegative().nullable().optional(),
  supplierPrices: z.array(supplierPriceSchema).max(50),
  extraUnits: z.array(extraUnitSchema).max(20),
});

export type SaveIngredientManagerInput = z.infer<
  typeof saveIngredientManagerSchema
>;

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

export interface IngredientManagerData {
  id: string;
  name: string;
  unit: string;
  section: string | null;
  reorderThreshold: number | null;
  costPerUnit: number;
  supplierPrices: Array<{
    id: string;
    supplierId: string;
    supplierName: string;
    buyUnit: string;
    /** Konversi buyUnit ke satuan dasar. null = buyUnit adalah satuan dasar. */
    buyUnitPerBase: number | null;
    /** Harga per 1 buyUnit. */
    unitCost: number;
    isPrimary: boolean;
    notes: string | null;
  }>;
  /** Satuan untuk opname/resep yang TIDAK dipakai harga supplier (mis. sachet). */
  extraUnits: Array<{ label: string; qtyPerBase: number }>;
}

/** Load semua data 1 bahan untuk modal "Kelola Bahan". */
export async function getIngredientManager(
  id: string,
): Promise<ApiResult<IngredientManagerData | null>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.ingredient.view")) {
    return fail("FORBIDDEN", "Tidak punya hak lihat bahan");
  }
  const outletId = session.user.outletId;
  const [ing] = await db
    .select({
      id: ingredients.id,
      outletId: ingredients.outletId,
      name: ingredients.name,
      unit: ingredients.unit,
      section: ingredients.section,
      reorderThreshold: ingredients.reorderThreshold,
      costPerUnit: ingredients.costPerUnit,
    })
    .from(ingredients)
    .where(eq(ingredients.id, id))
    .limit(1);
  if (!ing || ing.outletId !== outletId) return ok(null);

  const units = await loadIngredientUnitsOne(db, outletId, id);
  const prices = await db
    .select({
      id: supplierIngredients.id,
      supplierId: supplierIngredients.supplierId,
      buyUnit: supplierIngredients.packUnit,
      buyQty: supplierIngredients.packSize,
      unitCost: supplierIngredients.unitCost,
      isPrimary: supplierIngredients.isPrimary,
      notes: supplierIngredients.notes,
    })
    .from(supplierIngredients)
    .where(
      and(
        eq(supplierIngredients.outletId, outletId),
        eq(supplierIngredients.ingredientId, id),
        isNull(supplierIngredients.deletedAt),
      ),
    );
  /* Nama supplier — join terpisah supaya sederhana. */
  const supRows = await db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.outletId, outletId));
  const supName = new Map(supRows.map((s) => [s.id, s.name]));
  const baseLc = ing.unit.trim().toLowerCase();
  const convByLabel = new Map(
    units.packConversions.map((u) => [u.unitLabel.trim().toLowerCase(), u.qtyPerBase]),
  );
  const usedUnitLcs = new Set<string>();
  for (const p of prices) usedUnitLcs.add(p.buyUnit.trim().toLowerCase());

  return ok({
    id: ing.id,
    name: ing.name,
    unit: ing.unit,
    section: ing.section,
    reorderThreshold: ing.reorderThreshold,
    costPerUnit: ing.costPerUnit,
    supplierPrices: prices.map((p) => {
      const lc = p.buyUnit.trim().toLowerCase();
      const pSize = Number(p.buyQty) || 1;
      return {
        id: p.id,
        supplierId: p.supplierId,
        supplierName: supName.get(p.supplierId) ?? "—",
        buyUnit: p.buyUnit,
        buyUnitPerBase:
          lc === baseLc ? null : (convByLabel.get(lc) ?? null),
        /* Harga per 1 buyUnit (data lama packSize bisa >1 → bagi). */
        unitCost: Math.round(p.unitCost / pSize),
        isPrimary: p.isPrimary,
        notes: p.notes,
      };
    }),
    extraUnits: units.packConversions
      .filter((u) => {
        const lc = u.unitLabel.trim().toLowerCase();
        return lc !== baseLc && !usedUnitLcs.has(lc);
      })
      .map((u) => ({ label: u.unitLabel, qtyPerBase: u.qtyPerBase })),
  });
}

export async function saveIngredientManager(
  input: SaveIngredientManagerInput,
): Promise<ApiResult<{ id: string }>> {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "inventory.ingredient.update")) {
    return fail("FORBIDDEN", "Tidak punya hak kelola bahan");
  }
  const parsed = saveIngredientManagerSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Input tidak valid",
    );
  }
  const v = parsed.data;
  const outletId = session.user.outletId;
  const userId = session.user.id;
  const baseUnitLc = v.unit.trim().toLowerCase();

  /* Tepat ≤1 primary di antara harga supplier yang tidak dihapus. */
  const primaryCount = v.supplierPrices.filter(
    (p) => p.isPrimary && !p.deleted,
  ).length;
  if (primaryCount > 1) {
    return fail("VALIDATION_ERROR", "Hanya boleh 1 supplier utama (primary).");
  }

  try {
    const result = await db.transaction(async (tx) => {
      const now = new Date();

      /* Turunkan SATUAN dari baris harga supplier (konversi inline) + satuan
       * lain untuk opname. Dedup by lower(label); satuan primary = default. */
      const unitMap = new Map<
        string,
        { label: string; qty: number; isDefault: boolean }
      >();
      for (const p of v.supplierPrices) {
        if (p.deleted) continue;
        const lc = p.buyUnit.trim().toLowerCase();
        if (lc === baseUnitLc) continue; // satuan dasar bukan unit row
        if (p.buyUnitPerBase == null || p.buyUnitPerBase <= 0) continue;
        const ex = unitMap.get(lc);
        unitMap.set(lc, {
          label: p.buyUnit,
          qty: p.buyUnitPerBase,
          isDefault: (ex?.isDefault ?? false) || p.isPrimary,
        });
      }
      for (const e of v.extraUnits) {
        const lc = e.label.trim().toLowerCase();
        if (lc === baseUnitLc || unitMap.has(lc)) continue;
        unitMap.set(lc, { label: e.label, qty: e.qtyPerBase, isDefault: false });
      }
      const unitList = [...unitMap.values()];
      const defUnit = unitList.find((u) => u.isDefault) ?? null;
      const desiredBelanja = defUnit?.label ?? null;
      const desiredBelanjaPer = defUnit?.qty ?? null;
      const legacyPacks =
        unitList.length > 0
          ? unitList.map((u) => ({ unitLabel: u.label, qtyPerBase: u.qty }))
          : null;

      // ── 1. Upsert ingredient (identitas + dual-write kolom lama satuan) ──
      let ingredientId: string;
      if (v.id) {
        const [existing] = await tx
          .select({ id: ingredients.id, outletId: ingredients.outletId })
          .from(ingredients)
          .where(eq(ingredients.id, v.id))
          .limit(1);
        if (!existing || existing.outletId !== outletId) {
          throw new Error("NOT_FOUND");
        }
        ingredientId = v.id;
        await tx
          .update(ingredients)
          .set({
            name: v.name,
            unit: v.unit,
            section: v.section,
            reorderThreshold: v.reorderThreshold ?? null,
            unitBelanja: desiredBelanja,
            unitBelanjaPerCogs:
              desiredBelanjaPer == null ? null : desiredBelanjaPer.toFixed(4),
            packConversions: legacyPacks,
            updatedAt: now,
            updatedBy: userId,
          })
          .where(eq(ingredients.id, ingredientId));
      } else {
        const [created] = await tx
          .insert(ingredients)
          .values({
            outletId,
            name: v.name,
            unit: v.unit,
            costPerUnit: 0,
            currentStock: 0,
            currentStockDecimal: "0.0000",
            reorderThreshold: v.reorderThreshold ?? null,
            section: v.section,
            isPreparation: false,
            unitBelanja: desiredBelanja,
            unitBelanjaPerCogs:
              desiredBelanjaPer == null ? null : desiredBelanjaPer.toFixed(4),
            packConversions: legacyPacks,
            createdBy: userId,
            updatedBy: userId,
          })
          .returning({ id: ingredients.id });
        ingredientId = created!.id;
      }

      // ── 2. Satuan beli/pack → ingredient_units (sumber tunggal) ─────────
      await syncIngredientUnits(tx, outletId, ingredientId, {
        unitBelanja: desiredBelanja,
        unitBelanjaPerCogs: desiredBelanjaPer,
        packConversions: legacyPacks,
      });

      /* Map label → ingredient_unit_id (untuk set FK harga supplier). */
      const unitIdRows = await tx
        .select({ id: ingredientUnits.id, label: ingredientUnits.label })
        .from(ingredientUnits)
        .where(
          and(
            eq(ingredientUnits.ingredientId, ingredientId),
            isNull(ingredientUnits.deletedAt),
          ),
        );
      const unitIdByLabel = new Map<string, string>();
      for (const r of unitIdRows) {
        unitIdByLabel.set(r.label.trim().toLowerCase(), r.id);
      }

      // ── 3. Harga supplier (diff) ───────────────────────────────────────
      const loaded = await loadIngredientUnitsOne(tx, outletId, ingredientId);

      /* Clear semua primary aktif dulu (hindari transient 2-true). */
      await tx
        .update(supplierIngredients)
        .set({ isPrimary: false, updatedAt: now })
        .where(
          and(
            eq(supplierIngredients.outletId, outletId),
            eq(supplierIngredients.ingredientId, ingredientId),
            eq(supplierIngredients.isPrimary, true),
            isNull(supplierIngredients.deletedAt),
          ),
        );

      let primaryEffective: number | null = null;
      for (const p of v.supplierPrices) {
        const buyLc = p.buyUnit.trim().toLowerCase();
        const unitId =
          buyLc === baseUnitLc ? null : (unitIdByLabel.get(buyLc) ?? null);

        if (p.deleted) {
          if (p.id) {
            await tx
              .update(supplierIngredients)
              .set({ deletedAt: now, isPrimary: false, updatedAt: now, updatedBy: userId })
              .where(eq(supplierIngredients.id, p.id));
          }
          continue;
        }

        /* Harga per 1 buyUnit → effective per satuan dasar. */
        const r = resolveQtyToMaster({
          qty: 1,
          fromUnit: p.buyUnit,
          masterUnit: v.unit,
          ingredientPacks: loaded.packConversions,
          unitBelanja: loaded.unitBelanja,
          unitBelanjaPerCogs: loaded.unitBelanjaPerCogs,
        });
        const effective =
          r.ok && r.qtyMaster && r.qtyMaster > 0
            ? Math.round(p.unitCost / r.qtyMaster)
            : null;
        if (p.isPrimary) primaryEffective = effective;

        if (p.id) {
          await tx
            .update(supplierIngredients)
            .set({
              supplierId: p.supplierId,
              unitCost: p.unitCost,
              packSize: "1",
              packUnit: p.buyUnit,
              ingredientUnitId: unitId,
              isPrimary: false, // di-set true di akhir kalau primary
              notes: p.notes ?? null,
              updatedAt: now,
              updatedBy: userId,
            })
            .where(eq(supplierIngredients.id, p.id));
        } else {
          await tx.insert(supplierIngredients).values({
            outletId,
            supplierId: p.supplierId,
            ingredientId,
            unitCost: p.unitCost,
            packSize: "1",
            packUnit: p.buyUnit,
            ingredientUnitId: unitId,
            isPrimary: false,
            notes: p.notes ?? null,
            createdBy: userId,
            updatedBy: userId,
          });
        }
      }

      /* Set 1 primary terakhir (by supplier+ingredient match). */
      const primary = v.supplierPrices.find((p) => p.isPrimary && !p.deleted);
      if (primary) {
        await tx
          .update(supplierIngredients)
          .set({ isPrimary: true, updatedAt: now })
          .where(
            and(
              eq(supplierIngredients.outletId, outletId),
              eq(supplierIngredients.ingredientId, ingredientId),
              eq(supplierIngredients.supplierId, primary.supplierId),
              isNull(supplierIngredients.deletedAt),
            ),
          );
        if (primaryEffective != null) {
          await tx
            .update(ingredients)
            .set({
              costPerUnit: primaryEffective,
              costLastChangedAt: now,
              updatedAt: now,
              updatedBy: userId,
            })
            .where(eq(ingredients.id, ingredientId));
          await cascadeCostUpdate(tx, outletId, ingredientId, userId);
        }
      }

      return { id: ingredientId };
    });

    await logAudit({
      eventType: v.id
        ? "inventory.ingredient.update"
        : "inventory.ingredient.create",
      userId,
      entityType: "ingredient",
      entityId: result.id,
      payload: { summary: `Kelola bahan (terpadu): ${v.name}` },
    });
    return ok(result);
  } catch (e) {
    if (e instanceof Error && e.message === "NOT_FOUND") {
      return fail("NOT_FOUND", "Bahan tidak ditemukan");
    }
    return fail("DB_ERROR", e instanceof Error ? e.message : "Database error");
  }
}
