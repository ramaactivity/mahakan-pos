import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  integer,
  index,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";
import { shifts } from "./shifts";
import { menuItems } from "./menu";

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => shifts.id),
    cashierId: uuid("cashier_id")
      .notNull()
      .references(() => users.id),

    clientRefId: uuid("client_ref_id").unique(),
    transactionNumber: text("transaction_number").notNull().unique(),

    pagerNumber: integer("pager_number").notNull(),
    orderType: text("order_type", { enum: ["dine_in", "takeaway"] }).notNull(),

    subtotal: bigint("subtotal", { mode: "number" }).notNull(),
    discountType: text("discount_type", { enum: ["percent", "fixed"] }),
    discountValue: bigint("discount_value", { mode: "number" }),
    discountAmount: bigint("discount_amount", { mode: "number" })
      .notNull()
      .default(0),
    discountReason: text("discount_reason"),
    total: bigint("total", { mode: "number" }).notNull(),

    paymentMethod: text("payment_method", {
      enum: ["cash", "qris", "card_bca"],
    }).notNull(),
    cashReceived: bigint("cash_received", { mode: "number" }),
    cashChange: bigint("cash_change", { mode: "number" }),

    cogs: bigint("cogs", { mode: "number" }),

    status: text("status", {
      enum: ["paid", "voided", "refunded", "open"],
    })
      .notNull()
      .default("paid"),

    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidedApprover: uuid("voided_approver").references(() => users.id),
    voidReason: text("void_reason"),

    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    refundedBy: uuid("refunded_by").references(() => users.id),
    refundedApprover: uuid("refunded_approver").references(() => users.id),
    refundReason: text("refund_reason"),

    discountApprover: uuid("discount_approver").references(() => users.id),

    servedAt: timestamp("served_at", { withTimezone: true }),

    customerId: uuid("customer_id"),
    loyaltyPointsEarned: integer("loyalty_points_earned"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_transactions_shift").on(t.shiftId),
    index("idx_transactions_outlet_date").on(t.outletId, t.createdAt),
    index("idx_transactions_status").on(t.status),
    index("idx_transactions_payment_method").on(t.paymentMethod),
    check(
      "ck_transactions_pager_range",
      sql`${t.pagerNumber} BETWEEN 1 AND 99`,
    ),
    check(
      "ck_transactions_money_nonneg",
      sql`${t.subtotal} >= 0 AND ${t.discountAmount} >= 0 AND ${t.total} >= 0`,
    ),
    check(
      "ck_transactions_total_consistency",
      sql`${t.total} = ${t.subtotal} - ${t.discountAmount}`,
    ),
    check(
      "ck_transactions_cash_fields",
      sql`(${t.paymentMethod} = 'cash' AND ${t.cashReceived} IS NOT NULL)
        OR (${t.paymentMethod} <> 'cash' AND ${t.cashReceived} IS NULL AND ${t.cashChange} IS NULL)`,
    ),
    check(
      "ck_transactions_cogs_nonneg",
      sql`${t.cogs} IS NULL OR ${t.cogs} >= 0`,
    ),
  ],
);

export const transactionItems = pgTable(
  "transaction_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id),
    menuItemId: uuid("menu_item_id")
      .notNull()
      .references(() => menuItems.id),

    itemName: text("item_name").notNull(),
    itemCategoryName: text("item_category_name").notNull(),

    variant: text("variant", { enum: ["hot", "iced"] }),
    unitPrice: bigint("unit_price", { mode: "number" }).notNull(),
    quantity: integer("quantity").notNull(),
    modifiersPriceDelta: bigint("modifiers_price_delta", { mode: "number" })
      .notNull()
      .default(0),
    subtotal: bigint("subtotal", { mode: "number" }).notNull(),

    cogs: bigint("cogs", { mode: "number" }),

    note: text("note"),
    openPriceNote: text("open_price_note"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_transaction_items_transaction").on(t.transactionId),
    index("idx_transaction_items_menu_item").on(t.menuItemId),
    check(
      "ck_transaction_items_qty_pos",
      sql`${t.quantity} > 0`,
    ),
    check(
      "ck_transaction_items_money_nonneg",
      sql`${t.unitPrice} >= 0 AND ${t.modifiersPriceDelta} >= 0 AND ${t.subtotal} >= 0`,
    ),
    check(
      "ck_transaction_items_cogs_nonneg",
      sql`${t.cogs} IS NULL OR ${t.cogs} >= 0`,
    ),
  ],
);

export const transactionItemModifiers = pgTable(
  "transaction_item_modifiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionItemId: uuid("transaction_item_id")
      .notNull()
      .references(() => transactionItems.id),

    modifierSlug: text("modifier_slug").notNull(),
    selectedValue: text("selected_value"),
    priceDelta: bigint("price_delta", { mode: "number" }).notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_transaction_item_modifiers_item").on(t.transactionItemId)],
);
