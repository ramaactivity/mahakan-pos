"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  ingredients,
  ingredientUnits,
  stockOpnameLines,
  stockOpnameSessions,
  supplierIngredients,
  suppliers,
} from "@/db/schema";
import { auth, hasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit/logger";
import { cascadeCostUpdate } from "@/features/inventory/preparation-flow";
import {
  loadIngredientUnitsLadder,
  syncIngredientUnitsLadder,
  type LadderUnit,
} from "@/features/inventory/ingredient-units";
import { resolveLadderToBase } from "@/lib/unit-conversion";
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

/* Sesi AE-175c — Rantai konversi bertingkat (ladder) + harga supplier yang
 * MEMILIH satuan beli dari ladder (dropdown). 1 renceng = 10 sachet ;
 * 1 sachet = 28 gr → sistem hitung 1 renceng = 280 gr. */
const ladderUnitSchema = z.object({
  label: z.string().trim().min(1).max(20),
  /** 1 label = qtyPerRef refUnit. */
  qtyPerRef: z.number().positive().max(1_000_000),
  /** Satuan tujuan konversi; null = langsung ke satuan dasar. */
  refUnitLabel: z.string().trim().min(1).max(20).nullable(),
});

const supplierPriceSchema = z.object({
  id: z.uuid().nullable(),
  supplierId: z.uuid(),
  /** Satuan beli — dipilih dari ladder atau satuan dasar. */
  buyUnit: z.string().trim().min(1).max(20),
  /** Harga per 1 buyUnit. */
  unitCost: z.number().int().positive(),
  isPrimary: z.boolean(),
  notes: z.string().max(500).nullable().optional(),
  deleted: z.boolean().optional(),
});

const saveIngredientManagerSchema = z.object({
  id: z.uuid().nullable(),
  name: z.string().trim().min(1).max(120),
  unit: z.string().trim().min(1).max(20),
  section: z
    .enum(["kitchen", "bar", "supporting", "cleaning"])
    .nullable(),
  reorderThreshold: z.number().nonnegative().nullable().optional(),
  /** Tangga satuan & konversi (renceng→sachet→gr). */
  units: z.array(ladderUnitSchema).max(20),
  supplierPrices: z.array(supplierPriceSchema).max(50),
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
  /** Tangga satuan & konversi (renceng→sachet→gr). */
  units: Array<{
    label: string;
    qtyPerRef: number;
    refUnitLabel: string | null;
    qtyPerBase: number;
  }>;
  supplierPrices: Array<{
    id: string;
    supplierId: string;
    supplierName: string;
    buyUnit: string;
    /** Harga per 1 buyUnit. */
    unitCost: number;
    isPrimary: boolean;
    notes: string | null;
  }>;
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

  const ladder = await loadIngredientUnitsLadder(db, outletId, id);
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

  return ok({
    id: ing.id,
    name: ing.name,
    unit: ing.unit,
    section: ing.section,
    reorderThreshold: ing.reorderThreshold,
    costPerUnit: ing.costPerUnit,
    units: ladder.map((u) => ({
      label: u.label,
      qtyPerRef: u.qtyPerRef,
      refUnitLabel: u.refUnitLabel,
      qtyPerBase: u.qtyPerBase,
    })),
    supplierPrices: prices.map((p) => {
      const pSize = Number(p.buyQty) || 1;
      return {
        id: p.id,
        supplierId: p.supplierId,
        supplierName: supName.get(p.supplierId) ?? "—",
        buyUnit: p.buyUnit,
        /* Harga per 1 buyUnit (data lama packSize bisa >1 → bagi). */
        unitCost: Math.round(p.unitCost / pSize),
        isPrimary: p.isPrimary,
        notes: p.notes,
      };
    }),
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

      /* Resolve tangga konversi → qtyPerBase per satuan (validasi rantai). */
      let resolvedMap: Map<string, number>;
      try {
        resolvedMap = resolveLadderToBase(v.units, v.unit);
      } catch (e) {
        throw new Error(
          "LADDER:" + (e instanceof Error ? e.message : "rantai konversi invalid"),
        );
      }
      /* Default belanja = satuan supplier utama (kalau bukan satuan dasar). */
      const primaryPrice = v.supplierPrices.find((p) => p.isPrimary && !p.deleted);
      const defaultBuyLc =
        primaryPrice && primaryPrice.buyUnit.trim().toLowerCase() !== baseUnitLc
          ? primaryPrice.buyUnit.trim().toLowerCase()
          : null;
      const ladderUnits: LadderUnit[] = v.units.map((u) => ({
        label: u.label,
        qtyPerRef: u.qtyPerRef,
        refUnitLabel: u.refUnitLabel,
        isDefaultBuy: u.label.trim().toLowerCase() === defaultBuyLc,
      }));
      const defUnitRow = v.units.find(
        (u) => u.label.trim().toLowerCase() === defaultBuyLc,
      );
      const desiredBelanja = defUnitRow?.label ?? null;
      const desiredBelanjaPer = defaultBuyLc
        ? (resolvedMap.get(defaultBuyLc) ?? null)
        : null;
      const legacyPacks =
        v.units.length > 0
          ? v.units.map((u) => ({
              unitLabel: u.label,
              qtyPerBase:
                resolvedMap.get(u.label.trim().toLowerCase()) ?? u.qtyPerRef,
            }))
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

      // ── 2. Tangga satuan → ingredient_units (rantai bertingkat) ────────
      await syncIngredientUnitsLadder(
        tx,
        outletId,
        ingredientId,
        v.unit,
        ladderUnits,
      );

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

        /* Harga per 1 buyUnit → effective per satuan dasar (dari ladder). */
        const conv = buyLc === baseUnitLc ? 1 : (resolvedMap.get(buyLc) ?? null);
        const effective =
          conv && conv > 0 ? Math.round(p.unitCost / conv) : null;
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

      // ── Sinkron snapshot ke opname yang masih berjalan ─────────────────
      /* Sesi AE-176 — baris opname sesi in_progress membekukan nama, satuan,
       * DAN biaya (unit_cost_at_snapshot) saat sesi dimulai. Saat owner koreksi
       * master lewat Kelola Bahan, snapshot lama bikin halaman Opname tampil
       * data basi — paling parah biaya: cost lama yg salah (mis. 4.900/gr) bikin
       * "Terpakai (Rp)" meleset jutaan padahal master sudah 80/gr. Selaraskan
       * ketiganya ke master (idempoten/self-heal). Unique idx menjamin maks 1
       * sesi in_progress per outlet. */
      const [activeSession] = await tx
        .select({ id: stockOpnameSessions.id })
        .from(stockOpnameSessions)
        .where(
          and(
            eq(stockOpnameSessions.outletId, outletId),
            eq(stockOpnameSessions.status, "in_progress"),
          ),
        )
        .limit(1);
      if (activeSession) {
        const [costRow] = await tx
          .select({ cost: ingredients.costPerUnit })
          .from(ingredients)
          .where(eq(ingredients.id, ingredientId))
          .limit(1);
        await tx
          .update(stockOpnameLines)
          .set({
            unitSnapshot: v.unit,
            ingredientNameSnapshot: v.name,
            ...(costRow?.cost != null
              ? { unitCostAtSnapshot: costRow.cost }
              : {}),
          })
          .where(
            and(
              eq(stockOpnameLines.sessionId, activeSession.id),
              eq(stockOpnameLines.ingredientId, ingredientId),
            ),
          );
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
    if (e instanceof Error && e.message.startsWith("LADDER:")) {
      return fail("VALIDATION_ERROR", e.message.slice(7));
    }
    return fail("DB_ERROR", e instanceof Error ? e.message : "Database error");
  }
}
