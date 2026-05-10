import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  numeric,
  boolean,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";
import { suppliers } from "./suppliers";
import { ingredients } from "./inventory";

/**
 * Sesi AE-21 — Market List (supplier price catalog).
 *
 * Owner pakai spreadsheet "Data Master Food Cost — Marketlist" untuk
 * tracking harga belanja per bahan dari berbagai supplier. Sebelumnya
 * `ingredients.cost_per_unit` adalah satu-satunya source of truth, tapi
 * tidak ada visibility supplier mana yang nyediain harga itu, atau pack
 * size berapa.
 *
 * Tabel ini = M2M (supplier × ingredient) dengan harga + pack info.
 * Owner bisa simpan multi-supplier per bahan (banding harga), tapi
 * exactly satu yang `is_primary=true` per (outlet, ingredient) — itu
 * yang drive `ingredients.cost_per_unit` saat ada update via cascade.
 *
 * Effective unit cost = unitCost (Rp per pack) / packSize (pack qty in
 * ingredient master unit). Mis. Bawang Bombay 1000gr = Rp 36.000 →
 * effective = 36 Rp/gr → ditulis ke ingredients.cost_per_unit.
 *
 * Update flow:
 *   1. Owner edit harga di Market List UI.
 *   2. Action `updateMarketItem` → kalau `is_primary=true`:
 *      - Recompute effective unit cost
 *      - Overwrite ingredients.cost_per_unit
 *      - Trigger cascadeCostUpdate (recipes/preps/COGS auto-recompute)
 */
export const supplierIngredients = pgTable(
  "supplier_ingredients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),

    /** Harga total per pack (Rupiah, integer). Mis. Bawang Bombay 1kg = 36000. */
    unitCost: bigint("unit_cost", { mode: "number" }).notNull(),

    /** Ukuran pack (decimal) dalam unit pack. Mis. 1000 (gr), 1.5 (Kg), 12 (Pcs). */
    packSize: numeric("pack_size", { precision: 15, scale: 4 }).notNull(),

    /** Unit pack — string label (Kg, gr, L, ml, Pcs, Btl, Pack, dll).
     *  Konsisten dengan COMMON_UNITS di Catat Pembelian. Konversi ke
     *  ingredient.unit dilakukan saat compute effective_cost via lib
     *  unit-conversion (kalau dimensi sama, mis. Kg → gr ×1000). */
    packUnit: text("pack_unit").notNull(),

    /** Hanya satu boleh true per (outlet, ingredient) — enforced via
     *  partial unique index. Primary supplier drives ingredients.cost_per_unit. */
    isPrimary: boolean("is_primary").notNull().default(false),

    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    /** Cegah duplikat: 1 row per (supplier, ingredient) di outlet aktif. */
    uniqueIndex("ux_supplier_ingredients_active")
      .on(t.outletId, t.supplierId, t.ingredientId)
      .where(sql`${t.deletedAt} IS NULL`),
    /** Hanya 1 primary per (outlet, ingredient) — partial unique. */
    uniqueIndex("ux_supplier_ingredients_primary")
      .on(t.outletId, t.ingredientId)
      .where(sql`${t.isPrimary} = true AND ${t.deletedAt} IS NULL`),
    index("idx_supplier_ingredients_outlet_supplier").on(
      t.outletId,
      t.supplierId,
    ),
    index("idx_supplier_ingredients_outlet_ingredient").on(
      t.outletId,
      t.ingredientId,
    ),
    check("ck_si_unit_cost_pos", sql`${t.unitCost} > 0`),
    check("ck_si_pack_size_pos", sql`${t.packSize} > 0`),
  ],
);
