import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  boolean,
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
    costPerUnit: bigint("cost_per_unit", { mode: "number" })
      .notNull()
      .default(0),
    currentStock: bigint("current_stock", { mode: "number" })
      .notNull()
      .default(0),
    reorderThreshold: bigint("reorder_threshold", { mode: "number" }),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),

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
    check("ck_ingredients_cost_nonneg", sql`${t.costPerUnit} >= 0`),
    check(
      "ck_ingredients_threshold_nonneg",
      sql`${t.reorderThreshold} IS NULL OR ${t.reorderThreshold} >= 0`,
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
    menuItemId: uuid("menu_item_id")
      .notNull()
      .references(() => menuItems.id),
    variant: text("variant", { enum: ["hot", "iced"] }),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),

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
    // NULLS NOT DISTINCT (PG15+) — one recipe per (menu_item, variant), where
    // variant IS NULL counts as a single value (so a fixed-price item gets at
    // most one recipe). Hard delete only — historical COGS lives on transactions.cogs.
    unique("ux_recipes_menu_variant")
      .on(t.menuItemId, t.variant)
      .nullsNotDistinct(),
    index("idx_recipes_menu_item").on(t.menuItemId),
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
      ],
    }).notNull(),
    qtyDelta: bigint("qty_delta", { mode: "number" }).notNull(),
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
