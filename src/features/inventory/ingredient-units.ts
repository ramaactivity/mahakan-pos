/**
 * Sesi AE-175 — SUMBER TUNGGAL baca/tulis satuan beli/pack bahan dari tabel
 * ternormalisasi `ingredient_units`. Menggantikan kolom lama
 * `ingredients.unit_belanja/unit_belanja_per_cogs/pack_conversions`.
 *
 * Strategi membatasi blast-radius: `loadIngredientUnits` mengembalikan PERSIS
 * shape lama `{packConversions, unitBelanja, unitBelanjaPerCogs}` → langsung
 * di-feed ke `resolveQtyToMaster`/`buildOpnameUnitContext`/`convertPurchaseQty`
 * tanpa mengubah resolver.
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { ingredientUnits } from "@/db/schema";
import type { IngredientPackConversion } from "@/lib/unit-conversion";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = DbTx | typeof db;

export interface LoadedIngredientUnits {
  /** Semua satuan beli/pack aktif (termasuk yang default-buy). */
  packConversions: IngredientPackConversion[];
  /** Satuan default-buy (isDefaultBuy=true) → label. NULL kalau tak ada. */
  unitBelanja: string | null;
  unitBelanjaPerCogs: number | null;
}

const EMPTY: LoadedIngredientUnits = {
  packConversions: [],
  unitBelanja: null,
  unitBelanjaPerCogs: null,
};

/** Pure: agregasi baris ingredient_units (1 ingredient) → shape resolver.
 *  Diekstrak supaya testable tanpa DB. */
export function aggregateUnitRows(
  rows: Array<{ label: string; qtyPerBase: number | string; isDefaultBuy: boolean }>,
): LoadedIngredientUnits {
  const out: LoadedIngredientUnits = {
    packConversions: [],
    unitBelanja: null,
    unitBelanjaPerCogs: null,
  };
  for (const r of rows) {
    const qty = typeof r.qtyPerBase === "string" ? parseFloat(r.qtyPerBase) : r.qtyPerBase;
    if (!Number.isFinite(qty) || qty <= 0) continue;
    out.packConversions.push({ unitLabel: r.label, qtyPerBase: qty });
    if (r.isDefaultBuy) {
      out.unitBelanja = r.label;
      out.unitBelanjaPerCogs = qty;
    }
  }
  return out;
}

/** Pure: bangun daftar unit final dari editor (default + pack lain, dedup). */
export function buildDesiredUnitList(desired: {
  unitBelanja: string | null;
  unitBelanjaPerCogs: number | null;
  packConversions: IngredientPackConversion[] | null;
}): Array<{ label: string; qtyPerBase: number; isDefaultBuy: boolean }> {
  const finalUnits: Array<{ label: string; qtyPerBase: number; isDefaultBuy: boolean }> = [];
  const seen = new Set<string>();
  if (desired.unitBelanja && (desired.unitBelanjaPerCogs ?? 0) > 0) {
    finalUnits.push({
      label: desired.unitBelanja,
      qtyPerBase: desired.unitBelanjaPerCogs!,
      isDefaultBuy: true,
    });
    seen.add(desired.unitBelanja.trim().toLowerCase());
  }
  for (const p of desired.packConversions ?? []) {
    const lc = p.unitLabel.trim().toLowerCase();
    if (lc.length === 0 || seen.has(lc)) continue;
    if (!Number.isFinite(p.qtyPerBase) || p.qtyPerBase <= 0) continue;
    seen.add(lc);
    finalUnits.push({ label: p.unitLabel, qtyPerBase: p.qtyPerBase, isDefaultBuy: false });
  }
  return finalUnits;
}

/** Batch load satuan untuk N ingredient. Output di-feed ke resolver. */
export async function loadIngredientUnits(
  tx: DbOrTx,
  outletId: string,
  ingredientIds: string[],
): Promise<Map<string, LoadedIngredientUnits>> {
  const map = new Map<string, LoadedIngredientUnits>();
  for (const id of ingredientIds) {
    map.set(id, { packConversions: [], unitBelanja: null, unitBelanjaPerCogs: null });
  }
  if (ingredientIds.length === 0) return map;

  const rows = await tx
    .select({
      ingredientId: ingredientUnits.ingredientId,
      label: ingredientUnits.label,
      qtyPerBase: ingredientUnits.qtyPerBase,
      isDefaultBuy: ingredientUnits.isDefaultBuy,
    })
    .from(ingredientUnits)
    .where(
      and(
        eq(ingredientUnits.outletId, outletId),
        inArray(ingredientUnits.ingredientId, ingredientIds),
        isNull(ingredientUnits.deletedAt),
      ),
    )
    .orderBy(asc(ingredientUnits.sortOrder), asc(ingredientUnits.label));

  const byIngredient = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byIngredient.get(r.ingredientId) ?? [];
    arr.push(r);
    byIngredient.set(r.ingredientId, arr);
  }
  for (const [id, grp] of byIngredient) {
    map.set(id, aggregateUnitRows(grp));
  }
  return map;
}

/** Single-ingredient convenience. */
export async function loadIngredientUnitsOne(
  tx: DbOrTx,
  outletId: string,
  ingredientId: string,
): Promise<LoadedIngredientUnits> {
  const map = await loadIngredientUnits(tx, outletId, [ingredientId]);
  return map.get(ingredientId) ?? EMPTY;
}

/** Desired unit set untuk syncIngredientUnits (hasil parse editor). */
export interface DesiredIngredientUnits {
  /** Satuan Belanja Utama (default). NULL = tidak ada. */
  unitBelanja: string | null;
  unitBelanjaPerCogs: number | null;
  /** Satuan Pack Lain (TIDAK termasuk Belanja Utama). */
  packConversions: IngredientPackConversion[] | null;
}

/**
 * Replace-all satuan sebuah bahan dari editor (transaksional).
 * Upsert by lower(label) (pertahankan id → link supplier_ingredients aman),
 * soft-delete label yang hilang, set tepat 1 isDefaultBuy.
 * HARUS dipanggil di dalam transaksi.
 */
export async function syncIngredientUnits(
  tx: DbTx,
  outletId: string,
  ingredientId: string,
  desired: DesiredIngredientUnits,
): Promise<void> {
  const finalUnits = buildDesiredUnitList(desired);

  /* Existing aktif. */
  const existing = await tx
    .select({
      id: ingredientUnits.id,
      label: ingredientUnits.label,
    })
    .from(ingredientUnits)
    .where(
      and(
        eq(ingredientUnits.ingredientId, ingredientId),
        isNull(ingredientUnits.deletedAt),
      ),
    );
  const existingByLc = new Map(
    existing.map((e) => [e.label.trim().toLowerCase(), e.id]),
  );
  const now = new Date();

  /* (1) Clear semua default-buy dulu — hindari transient 2-true vs partial
   *     unique index. */
  await tx
    .update(ingredientUnits)
    .set({ isDefaultBuy: false, updatedAt: now })
    .where(
      and(
        eq(ingredientUnits.ingredientId, ingredientId),
        isNull(ingredientUnits.deletedAt),
        eq(ingredientUnits.isDefaultBuy, true),
      ),
    );

  /* (2) Upsert tiap unit final (default di-set false dulu, di-true di step 4). */
  const finalLcs = new Set<string>();
  let order = 0;
  let defaultId: string | null = null;
  for (const u of finalUnits) {
    const lc = u.label.trim().toLowerCase();
    finalLcs.add(lc);
    const existId = existingByLc.get(lc);
    if (existId) {
      await tx
        .update(ingredientUnits)
        .set({
          label: u.label,
          qtyPerBase: u.qtyPerBase.toFixed(4),
          sortOrder: order,
          updatedAt: now,
        })
        .where(eq(ingredientUnits.id, existId));
      if (u.isDefaultBuy) defaultId = existId;
    } else {
      const [ins] = await tx
        .insert(ingredientUnits)
        .values({
          outletId,
          ingredientId,
          label: u.label,
          qtyPerBase: u.qtyPerBase.toFixed(4),
          isDefaultBuy: false,
          sortOrder: order,
        })
        .returning({ id: ingredientUnits.id });
      if (u.isDefaultBuy && ins) defaultId = ins.id;
    }
    order++;
  }

  /* (3) Soft-delete label yang hilang dari daftar final. */
  for (const e of existing) {
    if (!finalLcs.has(e.label.trim().toLowerCase())) {
      await tx
        .update(ingredientUnits)
        .set({ deletedAt: now, isDefaultBuy: false, updatedAt: now })
        .where(eq(ingredientUnits.id, e.id));
    }
  }

  /* (4) Set 1 default-buy terakhir (aman dari unique index). */
  if (defaultId) {
    await tx
      .update(ingredientUnits)
      .set({ isDefaultBuy: true, updatedAt: now })
      .where(eq(ingredientUnits.id, defaultId));
  }
}
