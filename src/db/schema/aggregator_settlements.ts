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
  jsonb,
  integer,
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
      /* Sesi AE-182 — tambah edc_bni / edc_bri / edc_other supaya semua
       * mesin EDC punya settlement otomatis, bukan cuma BCA. Kolom ini text
       * polos tanpa CHECK constraint di DB, jadi tidak perlu migrasi. */
      enum: [
        "edc_bca",
        "edc_bni",
        "edc_bri",
        "edc_other",
        "gofood",
        "grabfood",
        "shopeefood",
        "qris",
      ],
    }).notNull(),

    periodFrom: date("period_from").notNull(),
    periodTo: date("period_to").notNull(),

    /** Sesi AE-165 — asal data settlement:
     *  - 'csv'      : hasil Import CSV (aggregator / rekonsiliasi bank)
     *  - 'auto_pos' : auto-generate harian dari transaksi POS (QRIS/EDC BCA)
     *  - 'manual'   : entry manual lama
     * Dipakai untuk badge UI + guard regen (hanya auto_pos yang aman di-
     * regenerate). Default 'manual' untuk baris lama (backward compat). */
    source: text("source", {
      enum: ["csv", "auto_pos", "manual"],
    })
      .notNull()
      .default("manual"),

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

    /** Sesi AE-77 — Per-order line items dari CSV import (optional, NULL
     * untuk manual entry). Format:
     *   { "rows": [{ "date": "YYYY-MM-DD", "orderNo"?: string, "gross": int,
     *               "fee": int, "net": int, "customer"?: string,
     *               "notes"?: string, "rawLine"?: number }], ... }
     * Dipakai untuk drilldown UI di Laporan Aggregator. Finance/akuntansi
     * audit per-order trail (tanggal, no order, gross, fee). */
    lineItems: jsonb("line_items"),
    /** Sesi AE-77 — quick count untuk list view tanpa parse JSON setiap kali.
     * NULL = no line items, 0 = empty array, N = N rows. */
    lineItemsCount: integer("line_items_count"),

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
