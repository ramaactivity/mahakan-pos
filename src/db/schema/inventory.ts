import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  boolean,
  integer,
  numeric,
  jsonb,
  index,
  uniqueIndex,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";
import { menuItems } from "./menu";

export const ingredients = pgTable(
  "ingredients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    name: text("name").notNull(),
    unit: text("unit").notNull(),
    /**
     * Operational section (Sesi O) — adopted from Owner's spreadsheet
     * `List Bahan Baku.csv`. NULL untuk bahan yang belum di-classify
     * (e.g. seed lama dari mock); UI surface "Belum diset" badge.
     */
    section: text("section", {
      enum: ["kitchen", "bar", "supporting", "cleaning"],
    }),
    costPerUnit: bigint("cost_per_unit", { mode: "number" })
      .notNull()
      .default(0),
    currentStock: bigint("current_stock", { mode: "number" })
      .notNull()
      .default(0),
    /** Sesi AE-12 — decimal-precision mirror untuk stock decimal (mis.
     * 0.5 kg, 1.25 L). NULL untuk legacy rows pre-AE-12; populated
     * forward di every stock-changing path. UI prefer decimal kalau
     * ada, fallback ke bigint currentStock. Truth source for AE-12+. */
    currentStockDecimal: numeric("current_stock_decimal", {
      precision: 15,
      scale: 4,
    }),
    reorderThreshold: bigint("reorder_threshold", { mode: "number" }),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),

    // Phase 2 Tier 1.2 (M23) — preparation flag + yield.
    // is_preparation = true means cost_per_unit is auto-computed from a
    // recipe targeting this ingredient (recipes.ingredient_id = this.id).
    // preparation_yield is the units produced per batch (in `unit`); used
    // to derive cost_per_unit = total_recipe_cost × (1 + waste/100) / yield.
    isPreparation: boolean("is_preparation").notNull().default(false),
    preparationYield: bigint("preparation_yield", { mode: "number" }),
    /** Stamped whenever cost_per_unit changes — observability for cascades. */
    costLastChangedAt: timestamp("cost_last_changed_at", { withTimezone: true }),

    /** Sesi AE-62y — pack conversions ingredient-level.
     *
     * Use case dari tim gudang: Lychee Kaleng master unit "pcs", tapi
     * staff biasanya beli & opname per "packs" (1 packs = 20 pcs). Tanpa
     * pack mapping di sini, staff harus manual ×20 di kepala saat input
     * opname → error-prone.
     *
     * Shape: Array<{ unitLabel: string; qtyPerBase: number }>
     *   - unitLabel: nama satuan alternatif (mis. "packs", "karton", "dus")
     *   - qtyPerBase: berapa banyak base-unit per 1 alternatif unit
     *
     * Example: Lychee Kaleng master "pcs" →
     *   packConversions = [
     *     { unitLabel: "packs", qtyPerBase: 20 },
     *     { unitLabel: "karton", qtyPerBase: 240 }
     *   ]
     *
     * Opname picker akan show pcs + packs + karton; saat staff pilih
     * "packs" dan input 1 → server simpan 20 pcs.
     *
     * NULL atau [] = no alternatives, hanya master unit.
     *
     * Tidak bertabrakan dengan supplier_ingredients.packSize (yang
     * supplier-scoped untuk Purchase flow); ini global per-ingredient
     * untuk Opname + future modules. */
    packConversions: jsonb("pack_conversions"),

    /** Sesi AE-130 — Multi-unit 3-tier (Anisa feedback).
     *
     * Konsep: 1 ingredient bisa punya 3 satuan berbeda untuk konteks
     * yang berbeda, sambil tetap pakai `unit` (di atas) sebagai SATUAN
     * COGS / TERKECIL / AUTHORITATIVE. Semua kalkulasi internal (stock,
     * cost, recipe, movement) tetap di-store dalam `unit`. Kolom-kolom
     * baru ini hanya MAPPING display + entry preference:
     *
     *  - unit_tracking + unit_tracking_per_cogs:
     *    Satuan terbesar untuk DISPLAY di Inventory list (human friendly).
     *    Misal: 1 Kotak susu = 1000 ml (`unit`=ml, unitTracking="Kotak",
     *    unitTrackingPerCogs=1000). UI tampilkan "2 Kotak" instead of
     *    "2000 ml" supaya owner/staff baca lebih natural. NULL = pakai
     *    `unit` apa adanya (no separate tracking display).
     *
     *  - unit_belanja + unit_belanja_per_cogs:
     *    Satuan default saat Catat Pembelian / Permintaan Belanja. Misal:
     *    susu master ml, beli per L (1 L = 1000 ml). Saat staff buka
     *    form purchase untuk ingredient ini, default unit picker = "L"
     *    + auto convert ke ml saat save. NULL = pakai `unit` apa adanya.
     *
     * Stock opname (per Anisa): tetap input dalam `unit` (terkecil) untuk
     * akurasi, tapi UI tampilkan auto-convert ke unit_tracking sebagai
     * preview ("2500 ml = 2.5 Kotak").
     *
     * Validasi: kalau unit_*_per_cogs di-set, harus > 0 (tidak boleh 0
     * atau negatif — divide-by-zero hazard). Kalau label di-set tanpa
     * per_cogs, treat as identity (1:1 — staff cuma re-label tanpa
     * konversi). */
    unitTracking: text("unit_tracking"),
    unitTrackingPerCogs: numeric("unit_tracking_per_cogs", {
      precision: 15,
      scale: 4,
    }),
    unitBelanja: text("unit_belanja"),
    unitBelanjaPerCogs: numeric("unit_belanja_per_cogs", {
      precision: 15,
      scale: 4,
    }),

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
    uniqueIndex("ux_ingredients_outlet_name_active")
      .on(t.outletId, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    index("idx_ingredients_outlet_active").on(t.outletId, t.isActive),
    index("idx_ingredients_outlet_section").on(t.outletId, t.section),
    check("ck_ingredients_cost_nonneg", sql`${t.costPerUnit} >= 0`),
    check(
      "ck_ingredients_threshold_nonneg",
      sql`${t.reorderThreshold} IS NULL OR ${t.reorderThreshold} >= 0`,
    ),
    check(
      "ck_ingredients_prep_yield_required",
      sql`${t.isPreparation} = false OR ${t.preparationYield} IS NOT NULL`,
    ),
    check(
      "ck_ingredients_prep_yield_pos",
      sql`${t.preparationYield} IS NULL OR ${t.preparationYield} > 0`,
    ),
    /* Sesi AE-130 — divide-by-zero guard untuk konversi unit. */
    check(
      "ck_ingredients_unit_tracking_per_cogs_pos",
      sql`${t.unitTrackingPerCogs} IS NULL OR ${t.unitTrackingPerCogs} > 0`,
    ),
    check(
      "ck_ingredients_unit_belanja_per_cogs_pos",
      sql`${t.unitBelanjaPerCogs} IS NULL OR ${t.unitBelanjaPerCogs} > 0`,
    ),
  ],
);

export const recipes = pgTable(
  "recipes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    /** Set when recipe targets a menu item. Mutually exclusive with ingredientId. */
    menuItemId: uuid("menu_item_id").references(() => menuItems.id),
    /** Set when recipe targets a preparation (ingredient with is_preparation=true). */
    ingredientId: uuid("ingredient_id").references(() => ingredients.id),
    variant: text("variant", { enum: ["hot", "iced"] }),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),

    /**
     * Q Factor — wastage / spillage buffer applied to total recipe cost.
     * Default 30 for menu recipes, 10 for preparations (per Owner spreadsheet
     * convention). COGS = sum(qty × cost) × (1 + waste/100). Stock deduction
     * also splits into lean qty (sale_deduct) + waste portion (waste movement).
     */
    wasteFactorPct: integer("waste_factor_pct").notNull().default(30),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    // XOR — recipe targets exactly one of menu_item OR preparation ingredient.
    check(
      "ck_recipes_target_xor",
      sql`(${t.menuItemId} IS NOT NULL AND ${t.ingredientId} IS NULL)
        OR (${t.menuItemId} IS NULL AND ${t.ingredientId} IS NOT NULL)`,
    ),
    check(
      "ck_recipes_waste_range",
      sql`${t.wasteFactorPct} >= 0 AND ${t.wasteFactorPct} <= 200`,
    ),
    // Menu side — Drizzle's uniqueIndex doesn't support NULLS NOT DISTINCT
    // alongside partial WHERE, so we split into two disjoint partial indexes:
    //   (a) variant items: one recipe per (menu_item, variant) for variant != NULL
    //   (b) fixed items:   one recipe per menu_item where variant IS NULL
    uniqueIndex("ux_recipes_menu_variant_set")
      .on(t.menuItemId, t.variant)
      .where(sql`${t.menuItemId} IS NOT NULL AND ${t.variant} IS NOT NULL`),
    uniqueIndex("ux_recipes_menu_no_variant")
      .on(t.menuItemId)
      .where(sql`${t.menuItemId} IS NOT NULL AND ${t.variant} IS NULL`),
    // Preparation side — one recipe per preparation ingredient. No variant.
    uniqueIndex("ux_recipes_preparation")
      .on(t.ingredientId)
      .where(sql`${t.ingredientId} IS NOT NULL`),
    index("idx_recipes_menu_item").on(t.menuItemId),
    index("idx_recipes_ingredient").on(t.ingredientId),
  ],
);

export const recipeIngredients = pgTable(
  "recipe_ingredients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    qty: bigint("qty", { mode: "number" }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("ux_recipe_ingredients_recipe_ingredient").on(
      t.recipeId,
      t.ingredientId,
    ),
    index("idx_recipe_ingredients_recipe").on(t.recipeId),
    index("idx_recipe_ingredients_ingredient").on(t.ingredientId),
    check("ck_recipe_ingredients_qty_pos", sql`${t.qty} > 0`),
  ],
);

export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),

    kind: text("kind", {
      enum: [
        "initial",
        "purchase",
        "sale_deduct",
        "adjust",
        "waste",
        "refund_restore",
        "void_restore",
        "edit_restore",
      ],
    }).notNull(),
    qtyDelta: bigint("qty_delta", { mode: "number" }).notNull(),
    /** Sesi AE-12 — decimal-precision mirror (signed). Untuk movement
     * dari decimal source (purchase 0.5 kg = +0.5000, waste 0.1 = -0.1000),
     * qtyDeltaDecimal = exact value. qtyDelta bigint tetap di-write
     * sebagai rounded snapshot untuk backward compat. NULL untuk legacy
     * rows pre-AE-12. */
    qtyDeltaDecimal: numeric("qty_delta_decimal", {
      precision: 15,
      scale: 4,
    }),
    unitCostAtMovement: bigint("unit_cost_at_movement", { mode: "number" }),

    referenceType: text("reference_type", {
      enum: ["transaction", "expense", "manual"],
    }),
    referenceId: uuid("reference_id"),
    reason: text("reason"),

    /** Sesi AE-130 — Anti-double-count flag (Anisa feedback).
     *
     * Saat staff input pembelian dengan tanggal SEBELUM opname finalized
     * yang lebih recent, stock fisik sudah include belanja tsb (Anisa
     * skenario: opname jam 20:00 = 100, lalu input bon belanja siang
     * jam 22:00 → kalau additive jadi 150, padahal fisik 100).
     *
     * Saat true:
     *  - Movement TIDAK update ingredient.currentStock + currentStockDecimal
     *  - Tetap masuk laporan COGS / Pergerakan untuk audit periode
     *  - UI Catat Pembelian tampilkan warning saat staff pilih tanggal
     *    < lastOpname.finalizedAt
     *
     * Default false untuk semua movement lain (sale_deduct, adjust, dst). */
    skippedStockUpdate: boolean("skipped_stock_update")
      .notNull()
      .default(false),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
  },
  (t) => [
    index("idx_inventory_movements_ingredient_date").on(
      t.ingredientId,
      t.createdAt,
    ),
    index("idx_inventory_movements_reference").on(
      t.referenceType,
      t.referenceId,
    ),
    index("idx_inventory_movements_outlet_date").on(t.outletId, t.createdAt),
    check(
      "ck_inventory_movements_unit_cost_nonneg",
      sql`${t.unitCostAtMovement} IS NULL OR ${t.unitCostAtMovement} >= 0`,
    ),
  ],
);

/**
 * Sesi AE-115 — Audit trail untuk perubahan cost_per_unit (WAC).
 *
 * Setiap kali ingredient.cost_per_unit berubah, insert row di sini supaya
 * owner bisa investigate: kapan cost berubah, dari berapa ke berapa,
 * trigger-nya apa (purchase auto-WAC, manual edit, opname adjust, dll).
 *
 * Read-only audit table — insert only, never update/delete.
 */
export const ingredientCostHistory = pgTable(
  "ingredient_cost_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),

    /** Cost sebelumnya (Rp/master-unit). NULL untuk first record. */
    oldCostPerUnit: bigint("old_cost_per_unit", { mode: "number" }),
    /** Cost baru (Rp/master-unit). */
    newCostPerUnit: bigint("new_cost_per_unit", { mode: "number" }).notNull(),

    triggerType: text("trigger_type", {
      enum: [
        "purchase_wac",
        "manual_edit",
        "bulk_csv",
        "opname_recalc",
        "cascade",
        "initial",
      ],
    }).notNull(),

    /** Optional reference (e.g., purchase id, opname session id). */
    triggerRefType: text("trigger_ref_type"),
    triggerRefId: uuid("trigger_ref_id"),

    /** Qty + value yang trigger update (untuk purchase: purchase qty + cost). */
    changedQty: numeric("changed_qty", { precision: 15, scale: 4 }),
    changedValue: bigint("changed_value", { mode: "number" }),

    actorId: uuid("actor_id").references(() => users.id),
    notes: text("notes"),

    changedAt: timestamp("changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_ingredient_cost_history_ingredient_date").on(
      t.ingredientId,
      t.changedAt,
    ),
    index("idx_ingredient_cost_history_outlet_date").on(
      t.outletId,
      t.changedAt,
    ),
    check(
      "ck_ingredient_cost_history_costs_nonneg",
      sql`${t.newCostPerUnit} >= 0 AND (${t.oldCostPerUnit} IS NULL OR ${t.oldCostPerUnit} >= 0)`,
    ),
  ],
);

/**
 * Sesi AE-175 — Satuan beli/pack ternormalisasi (SUMBER TUNGGAL).
 *
 * Menggantikan kolom lama `ingredients.unit_belanja/unit_belanja_per_cogs`
 * (1 satuan beli default) + `pack_conversions` jsonb (banyak pack) yang dulu
 * tersebar. Tiap row = "1 {label} = {qty_per_base} {ingredients.unit}".
 * Contoh Chocolatos (unit=gr): renceng=280, sachet=28.
 *
 * Satuan DASAR (ingredients.unit, qty_per_base=1) TIDAK disimpan sebagai row —
 * disisipkan oleh loader/resolver. `is_default_buy=true` = satuan default saat
 * Catat Pembelian (max 1 per bahan). supplier_ingredients.ingredient_unit_id
 * menunjuk ke sini supaya harga supplier ↔ konversi = satu kebenaran.
 */
export const ingredientUnits = pgTable(
  "ingredient_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),

    /** Label satuan beli/pack (mis. "renceng", "sachet", "Kg"). */
    label: text("label").notNull(),
    /** Berapa satuan DASAR (ingredients.unit) per 1 label ini — RESOLVED dari
     *  rantai (denormalized untuk resolver). > 0. */
    qtyPerBase: numeric("qty_per_base", { precision: 15, scale: 4 }).notNull(),
    /** Sesi AE-175c — rantai konversi bertingkat: 1 label = qtyPerRef refUnit.
     *  Mis. 1 renceng = 10 sachet → qtyPerRef=10, refUnitLabel="sachet".
     *  refUnitLabel NULL = konversi langsung ke satuan dasar. qtyPerRef NULL =
     *  legacy (treat = qtyPerBase, ref=dasar). */
    qtyPerRef: numeric("qty_per_ref", { precision: 15, scale: 4 }),
    refUnitLabel: text("ref_unit_label"),
    /** Satuan default saat Catat Pembelian (max 1 aktif per bahan). */
    isDefaultBuy: boolean("is_default_buy").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    /* 1 label unik per bahan (case-insensitive) di antara yang aktif. */
    uniqueIndex("ux_ingredient_units_label_active")
      .on(t.ingredientId, sql`lower(${t.label})`)
      .where(sql`${t.deletedAt} IS NULL`),
    /* Max 1 default-buy aktif per bahan. */
    uniqueIndex("ux_ingredient_units_default_buy")
      .on(t.ingredientId)
      .where(sql`${t.isDefaultBuy} = true AND ${t.deletedAt} IS NULL`),
    index("idx_ingredient_units_ingredient").on(t.ingredientId),
    index("idx_ingredient_units_outlet").on(t.outletId),
    check("ck_ingredient_units_qty_pos", sql`${t.qtyPerBase} > 0`),
  ],
);

/**
 * Sesi AE-116 — Period close untuk COGS reconciliation.
 *
 * Per pos_sale auto-journal sudah post Dr HPP + Cr Persediaan per
 * transaction (perpetual inventory). Period close compute selisih
 * antara recognized HPP (pos_sale running) vs actual COGS (WAC period
 * × consumed qty from opname), lalu post adjustment supaya Income
 * Statement HPP reflect actual cost.
 *
 * Idempotent: unique(outletId, periodYm). Tidak bisa close 2× per bulan.
 */
export const cogsPeriodCloses = pgTable(
  "cogs_period_closes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    /** YYYY-MM format, e.g. "2026-05". */
    periodYm: text("period_ym").notNull(),

    closedAt: timestamp("closed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedBy: uuid("closed_by")
      .notNull()
      .references(() => users.id),

    /** Total COGS dari WAC report (Rp). */
    totalCogs: bigint("total_cogs", { mode: "number" }).notNull(),
    /** Per-section breakdown JSON: { kitchen, bar, supporting, cleaning, unassigned }. */
    totalsBySection: text("totals_by_section_json").notNull(),

    /** Net adjustment posted ke journal (Rp, signed).
     * Positive = COGS actual > recognized (post Dr HPP increment).
     * Negative = COGS actual < recognized (post Cr HPP reversal). */
    adjustmentTotal: bigint("adjustment_total", { mode: "number" })
      .notNull()
      .default(0),
    /** FK ke journal_entries row kalau adjustment ke-post. NULL = no adjustment needed. */
    adjustmentJournalEntryId: uuid("adjustment_journal_entry_id"),

    notes: text("notes"),
  },
  (t) => [
    uniqueIndex("ux_cogs_period_closes_outlet_ym").on(t.outletId, t.periodYm),
    index("idx_cogs_period_closes_outlet_date").on(t.outletId, t.closedAt),
  ],
);
