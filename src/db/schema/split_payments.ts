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
import { transactions, transactionItems } from "./transactions";

/**
 * Split payment events for a single transaction (C-5 #13). Each row is
 * one customer's portion of a multi-payer bill. The transaction header
 * stays "open" until the sum of split_payments reaches transactions.total,
 * at which point the transaction is flipped to "paid" and
 * transactions.payment_method is set to "split" so receipts + reports
 * know to look here.
 *
 * `split_kind` distinguishes the two flows:
 *   - nominal: kasir entered a rupiah amount; not tied to specific items
 *   - per_menu: kasir picked specific items + qty (split_payment_items)
 */
export const splitPayments = pgTable(
  "split_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => shifts.id),
    cashierId: uuid("cashier_id")
      .notNull()
      .references(() => users.id),

    amount: bigint("amount", { mode: "number" }).notNull(),
    paymentMethod: text("payment_method", {
      enum: ["cash", "qris", "card_bca"],
    }).notNull(),
    cashReceived: bigint("cash_received", { mode: "number" }),
    cashChange: bigint("cash_change", { mode: "number" }),

    splitKind: text("split_kind", { enum: ["nominal", "per_menu"] }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_split_payments_transaction").on(t.transactionId),
    index("idx_split_payments_shift").on(t.shiftId),
    index("idx_split_payments_outlet_created").on(t.outletId, t.createdAt),
    check("ck_split_payments_amount_pos", sql`${t.amount} > 0`),
    check(
      "ck_split_payments_cash_fields",
      sql`(${t.paymentMethod} = 'cash' AND ${t.cashReceived} IS NOT NULL)
        OR (${t.paymentMethod} <> 'cash' AND ${t.cashReceived} IS NULL AND ${t.cashChange} IS NULL)`,
    ),
  ],
);

/**
 * Per-menu split detail rows. Only present when split_payments.split_kind
 * = 'per_menu'. quantity must be ≤ the matching transaction_item's
 * remaining unpaid quantity at insert time (validated server-side).
 */
export const splitPaymentItems = pgTable(
  "split_payment_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    splitPaymentId: uuid("split_payment_id")
      .notNull()
      .references(() => splitPayments.id, { onDelete: "cascade" }),
    transactionItemId: uuid("transaction_item_id")
      .notNull()
      .references(() => transactionItems.id),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_split_payment_items_split").on(t.splitPaymentId),
    index("idx_split_payment_items_trx_item").on(t.transactionItemId),
    check("ck_split_payment_items_qty_pos", sql`${t.quantity} > 0`),
  ],
);
