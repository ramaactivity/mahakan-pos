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
import { transactions, transactionItems } from "./transactions";

/**
 * Immutable history of refund events on a transaction. A full refund
 * creates one row with `kind='full'` and `total_refunded === transaction.total`.
 * A partial refund creates one row with `kind='partial'` and the pro-rata
 * sum of refunded items. Multiple partial events can stack on the same
 * transaction until cumulative reaches total → status flips to 'refunded'.
 *
 * Why a log table (not just transaction columns): partial refunds can
 * happen N times. Reports + audit need the per-event detail to show
 * "refunded 1× Espresso on Apr 29 12:00, 1× Croissant on Apr 29 13:30".
 */
export const refundEvents = pgTable(
  "refund_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    kind: text("kind", { enum: ["full", "partial"] }).notNull(),

    /** Sum of all refund_event_items for this event. Mirrored here for fast
     * SUM queries without joining the line table. */
    totalRefunded: bigint("total_refunded", { mode: "number" }).notNull(),

    reason: text("reason").notNull(),

    /** Staff/Manager/Owner who initiated. */
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    /** Approver: PIN-derived (legacy mode) OR Owner-via-code (B-2 code mode). */
    approverUserId: uuid("approver_user_id").references(() => users.id),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_refund_events_transaction").on(t.transactionId),
    index("idx_refund_events_outlet_created").on(t.outletId, t.createdAt),
    check("ck_refund_events_total_pos", sql`${t.totalRefunded} > 0`),
  ],
);

/** Per-item detail for a refund event. Composite key on (event, item). */
export const refundEventItems = pgTable(
  "refund_event_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    refundEventId: uuid("refund_event_id")
      .notNull()
      .references(() => refundEvents.id, { onDelete: "cascade" }),
    transactionItemId: uuid("transaction_item_id")
      .notNull()
      .references(() => transactionItems.id),
    quantityRefunded: integer("quantity_refunded").notNull(),
    /** Pro-rata rupiah refunded for this item line — `quantity_refunded`
     * × line's effective unit price (after item-level + transaction-level
     * discount allocation). */
    amountRefunded: bigint("amount_refunded", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_refund_event_items_event").on(t.refundEventId),
    index("idx_refund_event_items_trx_item").on(t.transactionItemId),
    check("ck_refund_event_items_qty_pos", sql`${t.quantityRefunded} > 0`),
    check(
      "ck_refund_event_items_amount_nonneg",
      sql`${t.amountRefunded} >= 0`,
    ),
  ],
);
