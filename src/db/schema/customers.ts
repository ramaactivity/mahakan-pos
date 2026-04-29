import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  integer,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";

/**
 * Loyalty customer ledger. Phone is the natural key — Indonesian numbers
 * normalised to digits-only at the action layer (62812... or 0812... both
 * stored without spaces/dashes). Soft-delete via deletedAt.
 *
 * Points balance + lifetime spend are denormalized for fast reads on the
 * POS member-lookup card. They're authoritatively updated whenever a
 * paid transaction completes (createTransaction + closeOpenBill).
 */
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    /** Digits-only normalized phone. Unique per outlet (active rows). */
    phone: text("phone").notNull(),
    name: text("name").notNull(),

    /** Loyalty points balance — earned via paid transactions, redeemed at
     * payment (Phase 2 Tier 1.3 redemption flow). */
    totalPoints: integer("total_points").notNull().default(0),
    /** Lifetime spend in rupiah. Cumulative sum of `transactions.total`
     * for paid (non-voided / non-refunded) rows linked to this customer. */
    totalSpent: bigint("total_spent", { mode: "number" }).notNull().default(0),
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
    uniqueIndex("ux_customers_outlet_phone_active")
      .on(t.outletId, t.phone)
      .where(sql`${t.deletedAt} IS NULL`),
    index("idx_customers_outlet_active")
      .on(t.outletId)
      .where(sql`${t.deletedAt} IS NULL`),
    index("idx_customers_name").on(t.name),
    check("ck_customers_phone_nonempty", sql`length(${t.phone}) >= 6`),
    check("ck_customers_points_nonneg", sql`${t.totalPoints} >= 0`),
    check("ck_customers_spent_nonneg", sql`${t.totalSpent} >= 0`),
  ],
);
