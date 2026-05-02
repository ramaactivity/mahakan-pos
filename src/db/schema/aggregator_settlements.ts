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
 * Sesi Q (Finance Q3): manual entry of bank/aggregator settlement statements.
 *
 * Finance team enters monthly statement totals from BCA (EDC), Gojek (GoFood),
 * Grab (GrabFood), Shopee (ShopeeFood), and QRIS provider. Reconciliation
 * report compares aggregator-reported gross vs sum of `shifts.{channel}Settlement`
 * (kasir-reported daily totals at shift close) over same period.
 *
 * `fee_amount` placeholder for future MDR tracking — Mahakan currently absorbs
 * no aggregator fees but column is here for forward compatibility.
 */
export const aggregatorSettlements = pgTable(
  "aggregator_settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    channel: text("channel", {
      enum: ["edc_bca", "gofood", "grabfood", "shopeefood", "qris"],
    }).notNull(),

    periodFrom: date("period_from").notNull(),
    periodTo: date("period_to").notNull(),

    grossAmount: bigint("gross_amount", { mode: "number" }).notNull(),
    feeAmount: bigint("fee_amount", { mode: "number" }).notNull().default(0),
    netAmount: bigint("net_amount", { mode: "number" }).notNull(),

    bankCreditedAt: timestamp("bank_credited_at", { withTimezone: true }),
    /** Sesi T: optional FK ke chart_of_accounts (asset bank account, code 11xx).
     * Kalau set, accounting auto-journal Dr akun ini saat create; kalau null,
     * fallback ke 1110 Bank BCA default. */
    bankAccountId: uuid("bank_account_id"),
    referenceNo: text("reference_no"),
    notes: text("notes"),

    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_aggregator_settlements_outlet_channel_period").on(
      t.outletId,
      t.channel,
      t.periodFrom,
    ),
    check(
      "ck_aggregator_settlements_period_range",
      sql`${t.periodTo} >= ${t.periodFrom}`,
    ),
    check(
      "ck_aggregator_settlements_gross_nonneg",
      sql`${t.grossAmount} >= 0`,
    ),
    check("ck_aggregator_settlements_fee_nonneg", sql`${t.feeAmount} >= 0`),
    check(
      "ck_aggregator_settlements_net_consistency",
      sql`${t.netAmount} = ${t.grossAmount} - ${t.feeAmount}`,
    ),
  ],
);
