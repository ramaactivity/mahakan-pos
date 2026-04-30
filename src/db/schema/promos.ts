import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  integer,
  boolean,
  date,
  time,
  index,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";

/**
 * Promos — master configuration for discounts/campaigns. Owner builds these
 * in backoffice; staff at POS can ONLY pick from this list (no manual
 * % / nominal entry per Owner standard sesi K 2026-04-30).
 *
 * Phase MVP scope: whole_bill or category-level discounts, time-windowed,
 * with optional approval requirement. Coupon codes / BOGO / stacking land
 * in Phase L+.
 */
export const promos = pgTable(
  "promos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    // Identity
    name: text("name").notNull(),
    description: text("description"),

    // Discount config
    discountType: text("discount_type", { enum: ["percent", "fixed"] }).notNull(),
    /** For percent: 1-100. For fixed: rupiah amount. */
    discountValue: bigint("discount_value", { mode: "number" }).notNull(),
    /** For percent type: cap the rupiah discount (e.g., 50% but max -Rp 20k).
     * NULL = no cap. Ignored for fixed type. */
    maxDiscountAmount: bigint("max_discount_amount", { mode: "number" }),

    // Scope
    /** whole_bill = applies to entire subtotal.
     *  category   = applies to subtotal of items matching scope_category_ids. */
    scope: text("scope", { enum: ["whole_bill", "category"] })
      .notNull()
      .default("whole_bill"),
    /** UUID array of category IDs when scope='category'. */
    scopeCategoryIds: uuid("scope_category_ids").array(),

    // Eligibility
    minSubtotal: bigint("min_subtotal", { mode: "number" }),
    /** ['dine_in', 'takeaway'] both. NULL = both. */
    applicableOrderTypes: text("applicable_order_types").array(),
    /** ['cash','qris','card_bca','split']. NULL = any. */
    applicablePaymentMethods: text("applicable_payment_methods").array(),

    // Time window
    startDate: date("start_date"),
    endDate: date("end_date"),
    /** [1..7] = Mon..Sun. NULL or empty = any day. */
    daysOfWeek: integer("days_of_week").array(),
    /** "HH:MM" time-of-day window (within applicable days). NULL = whole day. */
    startTime: time("start_time"),
    endTime: time("end_time"),

    // Limits
    maxTotalUses: integer("max_total_uses"),
    currentUses: integer("current_uses").notNull().default(0),

    // Approval
    requiresApproval: boolean("requires_approval").notNull().default(false),

    // Status & lifecycle
    status: text("status", {
      enum: ["draft", "active", "paused", "archived"],
    })
      .notNull()
      .default("draft"),

    // Audit
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
    index("idx_promos_outlet_status").on(t.outletId, t.status),
    index("idx_promos_active_window").on(t.startDate, t.endDate),
    check(
      "ck_promos_discount_value_positive",
      sql`${t.discountValue} > 0`,
    ),
    check(
      "ck_promos_percent_range",
      sql`${t.discountType} <> 'percent' OR (${t.discountValue} BETWEEN 1 AND 100)`,
    ),
    check(
      "ck_promos_max_discount_nonneg",
      sql`${t.maxDiscountAmount} IS NULL OR ${t.maxDiscountAmount} >= 0`,
    ),
    check(
      "ck_promos_min_subtotal_nonneg",
      sql`${t.minSubtotal} IS NULL OR ${t.minSubtotal} >= 0`,
    ),
    check(
      "ck_promos_uses_consistent",
      sql`${t.maxTotalUses} IS NULL OR ${t.currentUses} <= ${t.maxTotalUses}`,
    ),
    check(
      "ck_promos_date_range",
      sql`${t.startDate} IS NULL OR ${t.endDate} IS NULL OR ${t.startDate} <= ${t.endDate}`,
    ),
  ],
);

/**
 * Per-transaction record of which promo was used + actual discount given.
 * Snapshot pattern — discountAmount stored at apply-time, not derived,
 * because the underlying promo could be edited or archived later.
 */
export const promoUsages = pgTable(
  "promo_usages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promoId: uuid("promo_id")
      .notNull()
      .references(() => promos.id),
    /** FK declared loosely (no cascade) — transactions cannot be deleted
     * anyway; voided/refunded transactions still keep the usage row for
     * historical audit. */
    transactionId: uuid("transaction_id").notNull(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    /** Snapshot of rupiah discounted at the moment of apply. */
    discountAmount: bigint("discount_amount", { mode: "number" }).notNull(),

    appliedAt: timestamp("applied_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    appliedBy: uuid("applied_by")
      .notNull()
      .references(() => users.id),
    /** NULL when promo did not require approval. */
    approverId: uuid("approver_id").references(() => users.id),
  },
  (t) => [
    index("idx_promo_usages_promo").on(t.promoId),
    index("idx_promo_usages_transaction").on(t.transactionId),
    index("idx_promo_usages_outlet_date").on(t.outletId, t.appliedAt),
    check(
      "ck_promo_usages_amount_nonneg",
      sql`${t.discountAmount} >= 0`,
    ),
  ],
);
