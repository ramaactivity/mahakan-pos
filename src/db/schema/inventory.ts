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
