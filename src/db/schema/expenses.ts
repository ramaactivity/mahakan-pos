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
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";
import { transactions } from "./transactions";
import { payrollPeriods } from "./hr";

export const expenseCategories = pgTable(
  "expense_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    name: text("name").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    displayOrder: integer("display_order").notNull().default(0),

    /** Sesi U — Accounting tier: default account untuk expense yang pakai
     * kategori ini. Soft FK ke chart_of_accounts (asset bank/kas atau expense
     * 6xxx). UI selector di expense form fallback ke kategori default kalau
     * Owner skip pilihan account. NULL = fallback ke 6901 Lain-lain. */
    defaultAccountId: uuid("default_account_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [unique("ux_expense_categories_outlet_name").on(t.outletId, t.name)],
);

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    expenseDate: date("expense_date").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => expenseCategories.id),
    description: text("description").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    paymentMethod: text("payment_method", {
      enum: ["cash", "transfer", "other"],
    }).notNull(),
    receiptImageUrl: text("receipt_image_url"),

    refundedTransactionId: uuid("refunded_transaction_id").references(
      () => transactions.id,
    ),

    /** Sesi Q (Finance Q1): origin of this expense row.
     * - 'manual' = Owner/staff input via Kas section / POS petty cash
     * - 'purchase' = auto-created by purchase confirm (sesi O)
     * - 'payroll' = auto-created by payroll mark-paid (sesi Q)
     * - 'refund' = auto-created by transaction refund (counter-balance) */
    sourceType: text("source_type", {
      enum: ["manual", "purchase", "payroll", "refund"],
    })
      .notNull()
      .default("manual"),
    payrollPeriodId: uuid("payroll_period_id").references(
      () => payrollPeriods.id,
    ),
    /** Soft FK ke purchases.id (no hard constraint to avoid circular import;
     * integrity maintained via reverse purchases.expense_id FK + app logic). */
    purchaseId: uuid("purchase_id"),

    /** Sesi U — Accounting tier: explicit account_id selector (Owner pick di
     * Admin → Kas → Tambah Pengeluaran). Override default dari category.
     * Soft FK ke chart_of_accounts. NULL = fallback ke category.defaultAccountId
     * → 6901 Lain-lain ultimate fallback. */
    accountId: uuid("account_id"),

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
    deletedBy: uuid("deleted_by").references(() => users.id),
  },
  (t) => [
    index("idx_expenses_outlet_date").on(t.outletId, t.expenseDate),
    index("idx_expenses_category").on(t.categoryId),
    index("idx_expenses_source").on(t.sourceType, t.outletId, t.expenseDate),
    check("ck_expenses_amount_pos", sql`${t.amount} > 0`),
  ],
);

export const incomes = pgTable(
  "incomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    incomeDate: date("income_date").notNull(),
    description: text("description").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    paymentMethod: text("payment_method", {
      enum: ["cash", "transfer", "other"],
    }).notNull(),

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
    // Sesi AE-49 — audit trail untuk soft delete (parity dengan expenses).
    deletedBy: uuid("deleted_by").references(() => users.id),
  },
  (t) => [
    index("idx_incomes_outlet_date").on(t.outletId, t.incomeDate),
    check("ck_incomes_amount_pos", sql`${t.amount} > 0`),
  ],
);
