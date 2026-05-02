import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  date,
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";

/**
 * Sesi S — Accounting tier (Phase 2): foundational schema for double-entry
 * general ledger on top of existing single-entry Finance/Keuangan module.
 *
 * Cutover date: 2026-06-01. Pre-cutover transactions tidak di-journal —
 * akses via Finance views existing.
 *
 * 4 tables:
 *  - chart_of_accounts: ~52 default accounts seeded, custom account allowed
 *  - accounting_periods: monthly buckets, state machine open→closed→locked
 *  - journal_entries (header): per economic event, idempotent via (sourceType, sourceId)
 *  - journal_lines (detail): debit/credit lines, must balance per entry
 *
 * No journal posting actions sesi S — schema + COA + read-only UI saja.
 * Auto-journal hooks shipped sesi T+.
 *
 * Refer: docs/10-ACCOUNTING-DESIGN.md §3 untuk full spec.
 */

// ---------- chart_of_accounts ----------

export const chartOfAccounts = pgTable(
  "chart_of_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    code: text("code").notNull(), // e.g. "1101"
    name: text("name").notNull(), // e.g. "Kas Tunai (Drawer POS)"

    type: text("type", {
      enum: ["asset", "liability", "equity", "revenue", "cogs", "expense"],
    }).notNull(),

    normalBalance: text("normal_balance", {
      enum: ["debit", "credit"],
    }).notNull(),

    parentCode: text("parent_code"), // informational grouping, e.g. "1100"
    isContra: boolean("is_contra").notNull().default(false),
    isSystem: boolean("is_system").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),

    displayOrder: integer("display_order").notNull().default(0),
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
    uniqueIndex("ux_coa_outlet_code")
      .on(t.outletId, t.code)
      .where(sql`${t.deletedAt} IS NULL`),
    index("idx_coa_lookup").on(
      t.outletId,
      t.type,
      t.isActive,
      t.displayOrder,
    ),
  ],
);

// ---------- accounting_periods ----------

export const accountingPeriods = pgTable(
  "accounting_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),

    status: text("status", {
      enum: ["open", "closed", "locked"],
    })
      .notNull()
      .default("open"),

    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => users.id),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: uuid("locked_by").references(() => users.id),

    /** Nullable self-FK to journal_entries.id — set saat period close run.
     * Soft FK (text) untuk avoid circular dependency w/ journal_entries; resolved app-side. */
    closingEntryId: uuid("closing_entry_id"),

    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_periods_outlet_year_month").on(
      t.outletId,
      t.periodYear,
      t.periodMonth,
    ),
    check("ck_period_month_range", sql`${t.periodMonth} BETWEEN 1 AND 12`),
    check("ck_period_year_range", sql`${t.periodYear} BETWEEN 2020 AND 2100`),
  ],
);

// ---------- journal_entries (header) ----------

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    periodId: uuid("period_id")
      .notNull()
      .references(() => accountingPeriods.id),

    /** Format JE-YYYYMM-NNNN. Atomic per (outlet, period) via advisory lock. */
    entryNumber: text("entry_number").notNull(),

    /** Date of economic event (YYYY-MM-DD). Must fall within period. */
    entryDate: date("entry_date").notNull(),
    description: text("description").notNull(),

    sourceType: text("source_type", {
      enum: [
        "manual",
        "opening_balance",
        "pos_sale",
        "pos_refund",
        "pos_compliment",
        "purchase_create",
        "purchase_pay",
        "purchase_cancel",
        "payroll_paid",
        "expense_create",
        "expense_void",
        "income_create",
        "income_void",
        "cash_deposit_verified",
        "aggregator_settlement",
        "shift_variance",
        "opname_adjustment",
        "period_close",
        "period_reopen",
      ],
    }).notNull(),

    /** Soft FK ke source table (polymorphic). Null untuk manual / opening_balance. */
    sourceId: uuid("source_id"),

    status: text("status", {
      enum: ["draft", "posted", "reversed"],
    })
      .notNull()
      .default("posted"),

    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedBy: uuid("posted_by").references(() => users.id),

    /** Self-FK: kalau entry ini di-reverse, tunjuk ke counter-entry yang membatalkan. */
    reversedByEntryId: uuid("reversed_by_entry_id"),
    /** Self-FK: kalau entry ini ADALAH counter-entry, tunjuk ke entry asli yang dibatalkan. */
    reversesEntryId: uuid("reverses_entry_id"),
    reverseReason: text("reverse_reason"),

    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    uniqueIndex("ux_je_outlet_number").on(t.outletId, t.entryNumber),
    index("idx_je_period").on(t.periodId),
    index("idx_je_source").on(t.sourceType, t.sourceId),
    index("idx_je_outlet_date").on(t.outletId, t.entryDate),
  ],
);

// ---------- journal_lines (detail) ----------

export const journalLines = pgTable(
  "journal_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),

    /** 1-indexed within entry. */
    lineNumber: integer("line_number").notNull(),

    accountId: uuid("account_id")
      .notNull()
      .references(() => chartOfAccounts.id),

    debit: bigint("debit", { mode: "number" }).notNull().default(0),
    credit: bigint("credit", { mode: "number" }).notNull().default(0),

    description: text("description"),
    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_jl_entry_line").on(t.entryId, t.lineNumber),
    index("idx_jl_account").on(t.accountId),
    check(
      "ck_jl_amount_nonneg",
      sql`${t.debit} >= 0 AND ${t.credit} >= 0`,
    ),
    check(
      "ck_jl_xor",
      sql`(${t.debit} > 0 AND ${t.credit} = 0) OR (${t.debit} = 0 AND ${t.credit} > 0)`,
    ),
  ],
);
