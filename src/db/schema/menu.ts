import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  jsonb,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    name: text("name").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),

    /** Sesi S — Accounting tier: default revenue account untuk auto-journal POS sale.
     * Soft FK (no .references) untuk avoid circular import vs accounting.ts. Resolved app-side. */
    accountingRevenueAccountId: uuid("accounting_revenue_account_id"),
    /** Sesi S — Accounting tier: default COGS account untuk auto-journal POS sale. */
    accountingCogsAccountId: uuid("accounting_cogs_account_id"),

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
    unique("ux_categories_outlet_name").on(t.outletId, t.name),
    index("idx_categories_outlet_active").on(t.outletId, t.isActive),
  ],
);

export type ModifierOption = { value: string; label: string };

export const modifiers = pgTable("modifiers", {
  slug: text("slug").primaryKey(),
  label: text("label").notNull(),
  type: text("type", { enum: ["single_select", "toggle"] }).notNull(),
  optionsJson: jsonb("options_json").$type<ModifierOption[]>(),
  price: bigint("price", { mode: "number" }).notNull().default(0),
  appliesToCategories: text("applies_to_categories").array(),
  isActive: boolean("is_active").notNull().default(true),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id),
});

export const menuItems = pgTable(
  "menu_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),

    name: text("name").notNull(),
    description: text("description"),

    priceType: text("price_type", { enum: ["fixed", "variant", "open"] }).notNull(),
    priceFixed: bigint("price_fixed", { mode: "number" }),
    priceHot: bigint("price_hot", { mode: "number" }),
    priceIced: bigint("price_iced", { mode: "number" }),

    /** Sesi AE-173 — HPP manual per menu (Rp). NULL = belum diisi → fallback ke
     * COGS dari resep (perilaku lama). Kalau diisi, angka ini yang dipakai jadi
     * COGS saat jual (snapshot), tanpa waste factor. Margin% = (harga−cost)/harga. */
    cost: bigint("cost", { mode: "number" }),

    isSignature: boolean("is_signature").notNull().default(false),
    isSoldOut: boolean("is_sold_out").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),

    displayOrder: integer("display_order").notNull().default(0),

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
    index("idx_menu_items_category").on(t.categoryId),
    index("idx_menu_items_outlet_active").on(t.outletId, t.isActive),
    unique("ux_menu_items_category_name").on(t.categoryId, t.name),
    check(
      "ck_menu_items_price_consistency",
      sql`(${t.priceType} = 'fixed' AND ${t.priceFixed} IS NOT NULL AND ${t.priceHot} IS NULL AND ${t.priceIced} IS NULL)
        OR (${t.priceType} = 'variant' AND ${t.priceFixed} IS NULL AND (${t.priceHot} IS NOT NULL OR ${t.priceIced} IS NOT NULL))
        OR (${t.priceType} = 'open' AND ${t.priceFixed} IS NULL AND ${t.priceHot} IS NULL AND ${t.priceIced} IS NULL)`,
    ),
    check(
      "ck_menu_items_price_nonneg",
      sql`(${t.priceFixed} IS NULL OR ${t.priceFixed} >= 0)
        AND (${t.priceHot} IS NULL OR ${t.priceHot} >= 0)
        AND (${t.priceIced} IS NULL OR ${t.priceIced} >= 0)`,
    ),
    check("ck_menu_items_cost_nonneg", sql`${t.cost} IS NULL OR ${t.cost} >= 0`),
  ],
);
