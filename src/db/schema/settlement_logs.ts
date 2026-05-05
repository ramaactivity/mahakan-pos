import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  date,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";

/**
 * Settlement log per channel per hari (Phase 6.1, sesi AC-5).
 *
 * Owner input mutasi bank actual per channel untuk recon dengan POS sale.
 * `expected_amount` snapshot dari getExpectedSettlementByChannel saat row
 * pertama kali dibuat (frozen — kalau POS data berubah retroaktif, owner
 * delete + recreate row). `actual_amount` adalah mutasi bank actual yang
 * masuk ke rekening; variance = actual - expected (computed on read).
 *
 * Variance threshold default 1% (configurable nanti via settings):
 *   |actual - expected| / max(expected, 1) ≤ 1% → green
 *   ≤ 5%                                       → yellow
 *   > 5% atau opposite sign                    → red
 *
 * Channel canonical mirror payment_method enum + aggregator: cash, qris,
 * card_bca, card_bni, card_mandiri, card_bri, card_other, gofood,
 * grabfood, shopeefood.
 *
 * Idempotent via unique (outlet_id, settlement_date, channel) WHERE
 * deleted_at IS NULL — owner re-input pakai upsert (delete + recreate).
 */
export const settlementLogs = pgTable(
  "settlement_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    /** Tanggal sale (POS date). Settlement bank biasanya T+1, tapi log
     * ini tagged ke tanggal POS sale untuk konsisten dengan Daily
     * Settlement report. */
    settlementDate: date("settlement_date").notNull(),

    channel: text("channel", {
      enum: [
        "cash",
        "qris",
        "card_bca",
        "card_bni",
        "card_mandiri",
        "card_bri",
        "card_other",
        "gofood",
        "grabfood",
        "shopeefood",
      ],
    }).notNull(),

    expectedAmount: bigint("expected_amount", { mode: "number" })
      .notNull()
      .default(0),
    actualAmount: bigint("actual_amount", { mode: "number" })
      .notNull()
      .default(0),

    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("ux_settlement_logs_outlet_date_channel")
      .on(t.outletId, t.settlementDate, t.channel)
      .where(sql`${t.deletedAt} IS NULL`),
    index("idx_settlement_logs_outlet_date").on(
      t.outletId,
      t.settlementDate,
    ),
    check(
      "ck_settlement_logs_amounts_nonneg",
      sql`${t.expectedAmount} >= 0 AND ${t.actualAmount} >= 0`,
    ),
  ],
);
