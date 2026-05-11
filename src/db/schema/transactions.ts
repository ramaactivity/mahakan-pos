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
import { customers } from "./customers";

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

    /** Optional pager number 1..99. Null when kasir hasn't assigned one
     * (e.g. takeaway via Gojek doesn't need physical pager). Migration
     * 0010 (sesi C-2) relaxed the NOT NULL + check constraint to support
     * the cashier flow reorder (Galih ask #4) — items first, pager
     * prompted at Bayar/Simpan Bill. */
    pagerNumber: integer("pager_number"),
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
      enum: [
        "cash",
        "qris",
        "card_bca",
        "card_bni",
        "card_mandiri",
        "card_bri",
        "card_other",
        "split",
      ],
    }).notNull(),
    cashReceived: bigint("cash_received", { mode: "number" }),
    cashChange: bigint("cash_change", { mode: "number" }),

    cogs: bigint("cogs", { mode: "number" }),

    status: text("status", {
      enum: ["paid", "voided", "refunded", "open", "partially_refunded"],
    })
      .notNull()
      .default("paid"),

    /** Cumulative rupiah refunded across full + partial refund events.
     * For a fully-refunded trx, equals `total`. For partially-refunded,
     * equals sum of refund_event.total_refunded. Computed server-side
     * inside the same DB tx as the refund event insert. */
    refundedAmount: bigint("refunded_amount", { mode: "number" })
      .notNull()
      .default(0),

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

    customerName: text("customer_name"),

    /** Free-form bill-level note (catatan khusus pesanan). Optional, max
     * 200 chars (enforced server-side). Per-line item notes live on
     * `transaction_items.note` separately. */
    note: text("note"),

    customerId: uuid("customer_id").references(() => customers.id),
    loyaltyPointsEarned: integer("loyalty_points_earned"),
    loyaltyPointsRedeemed: integer("loyalty_points_redeemed"),

    /** Sesi K — link to master promos table. NULL for ad-hoc legacy
     * transactions (pre-promo-system) and any future ad-hoc kompensasi
     * paths. When set, transactions.discountAmount equals the snapshot
     * stored in promo_usages.discountAmount. */
    promoId: uuid("promo_id"),

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
      sql`${t.pagerNumber} IS NULL OR ${t.pagerNumber} BETWEEN 1 AND 99`,
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
        OR (${t.paymentMethod} = 'split' AND ${t.cashReceived} IS NULL AND ${t.cashChange} IS NULL)
        OR (${t.paymentMethod} NOT IN ('cash', 'split') AND ${t.cashReceived} IS NULL AND ${t.cashChange} IS NULL)`,
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

    /** Sesi AE-35 — KDS per-item prep status. Default 'pending' saat
     * transaction dibuat. Staff dapur/bar tap "Mulai" → 'in_progress',
     * tap "Selesai" → 'done'. Driver "Pesanan" tab dashboard + filters.
     *
     * Per-item granularity supaya partial completion visible: order 5 item,
     * 3 sudah jadi, 2 lagi diproses — kasir tau tepat status. */
    prepStatus: text("prep_status", {
      enum: ["pending", "in_progress", "done"],
    })
      .notNull()
      .default("pending"),
    /** Stamped saat prepStatus berubah ke 'done'. Buat hitung prep time
     * + audit + sort by oldest-pending di KDS view. */
    prepStartedAt: timestamp("prep_started_at", { withTimezone: true }),
    prepDoneAt: timestamp("prep_done_at", { withTimezone: true }),

    /** Cumulative quantity refunded across one or more partial refund
     * events. Cannot exceed `quantity`. Updated by refundTransactionPartial. */
    refundedQuantity: integer("refunded_quantity").notNull().default(0),
    /** Pro-rata rupiah refunded for this item. Sum across all events. */
    refundedAmount: bigint("refunded_amount", { mode: "number" })
      .notNull()
      .default(0),

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
    check(
      "ck_transaction_items_refunded_qty_bound",
      sql`${t.refundedQuantity} >= 0 AND ${t.refundedQuantity} <= ${t.quantity}`,
    ),
    check(
      "ck_transaction_items_refunded_amount_nonneg",
      sql`${t.refundedAmount} >= 0`,
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
