import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  integer,
  date,
  index,
  uniqueIndex,
  check,
  unique,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";
import { expenseCategories } from "./expenses";

/**
 * Sesi AE-62 — Historical reconciliation tables.
 *
 * Mahakan baru pakai POS ini <1 minggu (trial), tapi outlet sudah jalan 5+
 * tahun (sebelumnya pakai Majoo/Kasir Pintar). Owner butuh import data
 * historis 3-6 bulan untuk:
 *   1. Laporan akuntansi lengkap (P&L, cash flow bulanan)
 *   2. Investor reporting + trend chart (revenue growth, margin, COGS%)
 *
 * Mekanisme: aggregated daily summary (1 row per outlet per hari). BUKAN
 * per-transaction detail (Tier 3 di-skip — refer Majoo). Reports queries
 * di-union dengan tabel ini untuk daterange yang overlap.
 *
 * Tidak ada FK ke transactions/expenses — table mandiri, idempotent re-import
 * via UNIQUE (outlet_id, business_date) ON CONFLICT DO UPDATE.
 */
export const historicalDailySummary = pgTable(
  "historical_daily_summary",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    /** Tanggal bisnis WIB (YYYY-MM-DD). */
    businessDate: date("business_date").notNull(),

    // Revenue side
    grossRevenue: bigint("gross_revenue", { mode: "number" })
      .notNull()
      .default(0),
    totalRefund: bigint("total_refund", { mode: "number" })
      .notNull()
      .default(0),
    totalVoid: bigint("total_void", { mode: "number" }).notNull().default(0),
    totalDiscount: bigint("total_discount", { mode: "number" })
      .notNull()
      .default(0),
    /** Net = gross - refund - void - discount. Untuk P&L line "Pendapatan Bersih". */
    netRevenue: bigint("net_revenue", { mode: "number" }).notNull().default(0),
    transactionCount: integer("transaction_count").notNull().default(0),

    // COGS (untuk margin chart investor)
    cogs: bigint("cogs", { mode: "number" }).notNull().default(0),

    // Cash flow per channel (untuk reconciliation accuracy)
    cashIn: bigint("cash_in", { mode: "number" }).notNull().default(0),
    qrisIn: bigint("qris_in", { mode: "number" }).notNull().default(0),
    edcIn: bigint("edc_in", { mode: "number" }).notNull().default(0),
    /** GoFood + GrabFood + ShopeeFood combined (Majoo biasanya 1 angka aja). */
    aggregatorIn: bigint("aggregator_in", { mode: "number" })
      .notNull()
      .default(0),

    /** Sumber data: "Majoo CSV 2026-05-15", "Manual entry 2026-05-15", dll. */
    sourceLabel: text("source_label"),
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
    unique("ux_hist_daily_summary_outlet_date").on(t.outletId, t.businessDate),
    index("idx_hist_daily_summary_outlet_date").on(
      t.outletId,
      t.businessDate,
    ),
    check(
      "ck_hist_daily_summary_nonneg",
      sql`${t.grossRevenue} >= 0
        AND ${t.totalRefund} >= 0
        AND ${t.totalVoid} >= 0
        AND ${t.totalDiscount} >= 0
        AND ${t.netRevenue} >= 0
        AND ${t.transactionCount} >= 0
        AND ${t.cogs} >= 0`,
    ),
  ],
);

/**
 * Sesi AE-62 — Per-kategori expense breakdown historis. Granular supaya
 * P&L bulan lampau bisa breakdown per category (sewa, listrik, gaji, dll).
 *
 * `categoryId` nullable — kalau Majoo punya kategori yang tidak match
 * `expense_categories` master, fallback ke `categoryLabelLegacy` (TEXT).
 * Reports query coalesce label.
 */
export const historicalExpense = pgTable(
  "historical_expense",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    businessDate: date("business_date").notNull(),

    categoryId: uuid("category_id").references(() => expenseCategories.id),
    /** Fallback label dari Majoo kalau categoryId tidak match master. */
    categoryLabelLegacy: text("category_label_legacy"),

    amount: bigint("amount", { mode: "number" }).notNull(),
    description: text("description"),

    sourceLabel: text("source_label"),

    /** Sesi AE-62z — deterministic hash dari canonical
     * (businessDate, categoryId-or-label, amount, description-trim-lc).
     * Idempotent re-upload: kalau owner upload CSV 2x, hash match → ON
     * CONFLICT DO NOTHING, no duplicate. Sebelumnya tidak ada UNIQUE
     * → P&L over-count kalau re-upload. */
    sourceRowHash: text("source_row_hash"),

    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_hist_expense_outlet_date").on(t.outletId, t.businessDate),
    index("idx_hist_expense_category").on(t.categoryId),
    /** Sesi AE-62z — partial UNIQUE untuk idempotent insert. Legacy rows
     * (sourceRowHash NULL) tetap valid. */
    uniqueIndex("ux_hist_expense_outlet_row_hash")
      .on(t.outletId, t.sourceRowHash)
      .where(sql`${t.sourceRowHash} IS NOT NULL`),
    check("ck_hist_expense_amount_pos", sql`${t.amount} > 0`),
  ],
);
