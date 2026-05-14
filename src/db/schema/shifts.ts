import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";

export const shifts = pgTable(
  "shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),

    status: text("status", { enum: ["open", "closed"] })
      .notNull()
      .default("open"),
    openingCash: bigint("opening_cash", { mode: "number" }).notNull(),
    actualCash: bigint("actual_cash", { mode: "number" }),
    variance: bigint("variance", { mode: "number" }),

    notes: text("notes"),

    /** Free-form pesan dari kasir tutup shift untuk shift berikutnya.
     * Tampil di OpenShiftModal step 1 sebagai banner kalau previous
     * shift di outlet ini meninggalkan handover. Galih ask #10. */
    handoverMessage: text("handover_message"),

    /** Kasir-reported settlement totals saat close-shift, untuk
     * rekonsiliasi vs settlement aktual dari bank/aggregator
     * (Galih ask #11). All nullable — outlet boleh skip channel
     * yang gak relevan. Rupiah, non-negative. */
    edcSettlement: bigint("edc_settlement", { mode: "number" }),
    gofoodSettlement: bigint("gofood_settlement", { mode: "number" }),
    grabfoodSettlement: bigint("grabfood_settlement", { mode: "number" }),
    shopeefoodSettlement: bigint("shopeefood_settlement", { mode: "number" }),
    /** Sesi AE-56 — auto-filled saat closeShift dari sum transactions QRIS shift.
     * Sebelum AE-56, rekonsiliasi QRIS pakai hardcode 0 → Reported Shifts selalu
     * 0 padahal POS Actual ada → false-positive selisih. Nullable backward-compat;
     * lazy-compute di query kalau null. */
    qrisSettlement: bigint("qris_settlement", { mode: "number" }),
    /** Sesi AE-56 — opsional, jumlah cash yang kasir claim ada di drawer
     * saat tutup shift (pisah dari paidCash hitung POS). Future-use untuk
     * 3-way cash reconciliation kalau owner pakai. Default null = pakai
     * (actualCash - openingCash + refundedCash - paidQris - paidCard). */
    cashSalesReported: bigint("cash_sales_reported", { mode: "number" }),

    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_shifts_user_status").on(t.userId, t.status),
    index("idx_shifts_outlet_opened").on(t.outletId, t.openedAt),
    uniqueIndex("ux_shifts_user_active")
      .on(t.userId)
      .where(sql`${t.status} = 'open'`),
    check("ck_shifts_opening_nonneg", sql`${t.openingCash} >= 0`),
    check(
      "ck_shifts_actual_nonneg",
      sql`${t.actualCash} IS NULL OR ${t.actualCash} >= 0`,
    ),
    check(
      "ck_shifts_settlements_nonneg",
      sql`(${t.edcSettlement} IS NULL OR ${t.edcSettlement} >= 0)
        AND (${t.gofoodSettlement} IS NULL OR ${t.gofoodSettlement} >= 0)
        AND (${t.grabfoodSettlement} IS NULL OR ${t.grabfoodSettlement} >= 0)
        AND (${t.shopeefoodSettlement} IS NULL OR ${t.shopeefoodSettlement} >= 0)`,
    ),
    check(
      "ck_shifts_close_consistency",
      sql`(${t.status} = 'closed' AND ${t.closedAt} IS NOT NULL)
        OR (${t.status} = 'open' AND ${t.closedAt} IS NULL)`,
    ),
  ],
);
