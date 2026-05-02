import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  date,
  index,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";

/**
 * Sesi Q (Finance Q2): cash deposit (Setoran Tunai) lifecycle.
 *
 * Manager operasional collects cash from kasir, holds (mengendap), dan
 * periodically (irregular schedule) deposits ke bank → owner. Each deposit
 * starts as `pending_verification`; Owner verifies (matches bank slip) atau
 * rejects.
 *
 * `covers_from_date`/`covers_to_date` mark the cash window settled by
 * this deposit. Cash-on-hand calc subtracts only verified deposits; pending
 * deposits are visible but don't yet reduce the running balance (until verified).
 *
 * `bank_destination` is free text ("BCA — Owner 1234567890") — no bank-account
 * master table in Phase Q (deferred).
 */
export const cashDeposits = pgTable(
  "cash_deposits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    depositDate: date("deposit_date").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    bankDestination: text("bank_destination").notNull(),
    referenceNo: text("reference_no"),
    photoUrl: text("photo_url"),
    notes: text("notes"),

    status: text("status", {
      enum: ["pending_verification", "verified", "rejected"],
    })
      .notNull()
      .default("pending_verification"),

    coversFromDate: date("covers_from_date").notNull(),
    coversToDate: date("covers_to_date").notNull(),

    depositedBy: uuid("deposited_by")
      .notNull()
      .references(() => users.id),
    verifiedBy: uuid("verified_by").references(() => users.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    rejectedReason: text("rejected_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_cash_deposits_outlet_status_date").on(
      t.outletId,
      t.status,
      t.depositDate,
    ),
    index("idx_cash_deposits_outlet_depositor").on(t.outletId, t.depositedBy),
    check("ck_cash_deposits_amount_pos", sql`${t.amount} > 0`),
    check(
      "ck_cash_deposits_covers_range",
      sql`${t.coversToDate} >= ${t.coversFromDate}`,
    ),
    check(
      "ck_cash_deposits_verified_consistency",
      sql`(${t.status} = 'verified' AND ${t.verifiedBy} IS NOT NULL AND ${t.verifiedAt} IS NOT NULL)
        OR (${t.status} = 'rejected' AND ${t.rejectedReason} IS NOT NULL)
        OR (${t.status} = 'pending_verification' AND ${t.verifiedBy} IS NULL AND ${t.verifiedAt} IS NULL AND ${t.rejectedReason} IS NULL)`,
    ),
  ],
);
