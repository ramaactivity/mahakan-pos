import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  integer,
  decimal,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";
import { journalEntries } from "./accounting";
import { capitalMovements } from "./capital_movements";

/**
 * Sesi AE-63a — Profit distribution (1 per period bulan).
 *
 * Header tabel untuk dividen bulanan. Trigger: akhir bulan, owner klik
 * "Hitung Bulan Ini" → server fetch netProfit dari Income Statement →
 * call computeDistribution pure helper → save status='draft'.
 *
 * Owner review preview → "Approve & Post" → server kirim 6-digit code
 * email → owner forward → input code → status='posted', journal
 * entries created, statement emails sent via after().
 *
 * Schema config (bagiHasilPct, dst) di-snapshot saat compute supaya
 * audit trail jelas walaupun owner edit default config kemudian.
 */
export const profitDistributions = pgTable(
  "profit_distributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    periodYear: integer("period_year").notNull(),
    /** 1-12 */
    periodMonth: integer("period_month").notNull(),

    /** Rupiah, snapshot dari fetchIncomeStatement.netIncome saat compute.
     *  Frozen di sini supaya late expense entry tidak drift hasil distribusi. */
    netProfitSnapshot: bigint("net_profit_snapshot", { mode: "number" }).notNull(),

    /** Pct allocation snapshot (max 100.00 total). Decimal(5,2) cukup
     *  untuk 0.00-100.00. */
    bagiHasilPct: decimal("bagi_hasil_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("10.00"),
    lossPct: decimal("loss_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("3.00"),
    capexPct: decimal("capex_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("0.70"),
    retainedPct: decimal("retained_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("0.20"),

    /** Investor pool : Pengelola pool split dari bagiHasil pool. */
    investorPoolPct: decimal("investor_pool_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("35.00"),
    pengelolaPoolPct: decimal("pengelola_pool_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("65.00"),

    /** Computed pool amounts (Rupiah) — denormalized untuk display speed.
     *  Sum of all profit_distribution_lines.amountRupiah per holder type
     *  harus = pool amount yang sama. */
    bagiHasilAmount: bigint("bagi_hasil_amount", { mode: "number" }).notNull(),
    lossAmount: bigint("loss_amount", { mode: "number" }).notNull(),
    capexAmount: bigint("capex_amount", { mode: "number" }).notNull(),
    retainedAmount: bigint("retained_amount", { mode: "number" }).notNull(),
    investorPoolAmount: bigint("investor_pool_amount", {
      mode: "number",
    }).notNull(),
    pengelolaPoolAmount: bigint("pengelola_pool_amount", {
      mode: "number",
    }).notNull(),

    status: text("status", {
      enum: ["draft", "approved", "posted", "cancelled"],
    })
      .notNull()
      .default("draft"),

    /** Approval flow */
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    /** Post = jurnal di-create + email sent. */
    postedAt: timestamp("posted_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledReason: text("cancelled_reason"),

    /** Link ke header jurnal Dr 3201 Cr 1101 (bulk single entry,
     *  N lines per holder). Populated saat status='posted'. */
    journalEntryId: uuid("journal_entry_id").references(
      () => journalEntries.id,
    ),

    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    index("idx_distributions_outlet_period").on(
      t.outletId,
      t.periodYear,
      t.periodMonth,
    ),
    /* Partial unique: hanya 1 distribution approved/posted per period
     * per outlet. Draft boleh banyak (preview iteration). */
    uniqueIndex("ux_distributions_active_per_period")
      .on(t.outletId, t.periodYear, t.periodMonth)
      .where(sql`status IN ('approved', 'posted')`),
    check("ck_distribution_month_range", sql`${t.periodMonth} BETWEEN 1 AND 12`),
    check("ck_distribution_year_range", sql`${t.periodYear} BETWEEN 2020 AND 2100`),
    check(
      "ck_distribution_pools_consistent",
      sql`${t.investorPoolPct}::numeric + ${t.pengelolaPoolPct}::numeric = 100.00`,
    ),
  ],
);

/**
 * Per-holder line di profit distribution.
 *
 * 1 row per investor + pengelola. Sum amountRupiah per holderType harus
 * sama dengan pool amount di header (ada residue rounding ke retained).
 */
export const profitDistributionLines = pgTable(
  "profit_distribution_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    distributionId: uuid("distribution_id")
      .notNull()
      .references(() => profitDistributions.id, { onDelete: "cascade" }),

    holderType: text("holder_type", {
      enum: ["investor", "pengelola"],
    }).notNull(),
    holderId: uuid("holder_id").notNull(),

    /** Snapshot modal disetor saat compute (capture momen, jangan
     *  pull live supaya distribusi yang sudah posted tidak drift). */
    modalDisetorSnapshot: bigint("modal_disetor_snapshot", {
      mode: "number",
    }).notNull(),

    /** %-share holder dalam pool (e.g. 0.5500 = 0.55%).
     *  Decimal(8,4) cukup untuk 0.0001-100.0000. */
    sharePct: decimal("share_pct", { precision: 8, scale: 4 }).notNull(),

    /** Dividen Rupiah untuk holder ini (floor rounded). */
    amountRupiah: bigint("amount_rupiah", { mode: "number" }).notNull(),

    /** Link ke capital_movements row yang di-create saat distribution
     *  status='posted'. Null sampai posted. */
    capitalMovementId: uuid("capital_movement_id").references(
      () => capitalMovements.id,
    ),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_dist_lines_distribution").on(t.distributionId),
    index("idx_dist_lines_holder").on(t.holderType, t.holderId),
    /* 1 line per holder per distribution. */
    uniqueIndex("ux_dist_lines_distribution_holder").on(
      t.distributionId,
      t.holderType,
      t.holderId,
    ),
    check("ck_dist_lines_amount_nonneg", sql`${t.amountRupiah} >= 0`),
    check(
      "ck_dist_lines_share_pct_range",
      sql`${t.sharePct}::numeric BETWEEN 0 AND 100`,
    ),
  ],
);
