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
import { bankAccounts } from "./bank-accounts";
import { expenseCategories } from "./expenses";
import { journalEntries } from "./accounting";

/**
 * Sesi AE-180 — Hutang Internal (Talangan Owner/Pengelola).
 *
 * Kasus nyata: owner/pengelola sering nalangin pengeluaran pakai uang
 * pribadi saat kas bisnis tidak cukup. Itu BUKAN pinjaman formal berbunga
 * (→ creditors/2150), melainkan hutang internal tanpa bunga ke orang dalam.
 * Akun GL: 2170 Hutang Internal (Talangan) — liability, system account.
 *
 * Model: LEDGER PER ORANG (beda dari creditors yang 1 row = 1 pinjaman).
 * 1 party (owner/manager/staff/lainnya) punya BANYAK entry talangan kecil
 * + banyak cicilan. `totalOutstanding` di party = denormalized running
 * balance (sum entries posted − sum repayments posted), di-maintain
 * service layer dalam transaction + CHECK >= 0.
 *
 * 2 jenis entry (kind):
 *  - 'expense_advance' = talangan biaya. Owner bayar pengeluaran pakai
 *    uang pribadi → Dr <akun beban kategori> / Cr 2170. Kas bisnis TIDAK
 *    berkurang. Auto-create expenses row (sourceType='internal_debt')
 *    supaya tetap muncul di Keuangan → Pengeluaran + P&L benar.
 *  - 'cash_loan' = pinjaman tunai masuk. Owner transfer uang pribadi ke
 *    rekening bisnis → Dr <bank> / Cr 2170.
 *
 * Cicilan (repayment): Dr 2170 / Cr <bank> — mirror creditor_repayments
 * tanpa komponen bunga. Reversal pair-void pattern sama.
 */
export const internalDebtParties = pgTable(
  "internal_debt_parties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    /** Nama orang (owner/manager/pihak internal lain). */
    name: text("name").notNull(),
    partyType: text("party_type", {
      enum: ["owner", "manager", "staff", "other"],
    })
      .notNull()
      .default("owner"),
    phone: text("phone"),

    // Bank tujuan transfer cicilan (informasi display, bukan FK).
    bankName: text("bank_name"),
    bankAccountNumber: text("bank_account_number"),
    bankAccountHolderName: text("bank_account_holder_name"),

    notes: text("notes"),

    /** Sisa hutang berjalan (denormalized, maintained service layer).
     * = SUM(entries posted) − SUM(repayments posted). */
    totalOutstanding: bigint("total_outstanding", { mode: "number" })
      .notNull()
      .default(0),

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
    index("idx_internal_debt_parties_outlet").on(t.outletId),
    /* Nama unik per outlet (yang belum dihapus) — cegah dobel orang. */
    uniqueIndex("ux_internal_debt_parties_outlet_name")
      .on(t.outletId, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    check(
      "ck_internal_debt_parties_outstanding_nonneg",
      sql`${t.totalOutstanding} >= 0`,
    ),
  ],
);

export const internalDebtEntries = pgTable(
  "internal_debt_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    partyId: uuid("party_id")
      .notNull()
      .references(() => internalDebtParties.id),

    /** 'expense_advance' = talangan biaya; 'cash_loan' = pinjaman tunai. */
    kind: text("kind", {
      enum: ["expense_advance", "cash_loan"],
    }).notNull(),

    /** Nominal hutang baru (Rupiah). */
    amount: bigint("amount", { mode: "number" }).notNull(),

    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    description: text("description").notNull(),

    /** kind='expense_advance': kategori pengeluaran (FK expense_categories).
     * NULL untuk cash_loan. */
    categoryId: uuid("category_id").references(() => expenseCategories.id),
    /** kind='expense_advance': soft FK ke expenses row yang auto-created
     * (sourceType='internal_debt') supaya muncul di Keuangan. */
    expenseId: uuid("expense_id"),
    /** kind='cash_loan': rekening bisnis yang menerima uang (FK bank_accounts).
     * NULL untuk expense_advance. */
    bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),

    /** Idempotent via recordJournal sourceType='internal_debt_expense' |
     * 'internal_debt_loan' + sourceId=this.id. */
    journalEntryId: uuid("journal_entry_id").references(
      () => journalEntries.id,
    ),

    status: text("status", {
      enum: ["posted", "reversed"],
    })
      .notNull()
      .default("posted"),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by").references(() => users.id),
    reversalReason: text("reversal_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    index("idx_internal_debt_entries_party").on(t.partyId, t.occurredAt),
    index("idx_internal_debt_entries_outlet_date").on(
      t.outletId,
      t.occurredAt,
    ),
    check("ck_internal_debt_entries_amount_pos", sql`${t.amount} > 0`),
  ],
);

export const internalDebtRepayments = pgTable(
  "internal_debt_repayments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    partyId: uuid("party_id")
      .notNull()
      .references(() => internalDebtParties.id),

    /** Rekening bisnis sumber pembayaran cicilan (FK bank_accounts). */
    bankAccountId: uuid("bank_account_id")
      .notNull()
      .references(() => bankAccounts.id),

    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** Nominal cicilan (Rupiah). Decrement party.totalOutstanding. */
    amount: bigint("amount", { mode: "number" }).notNull(),

    description: text("description"),

    /** Idempotent via recordJournal sourceType='internal_debt_repayment'
     * + sourceId=this.id. */
    journalEntryId: uuid("journal_entry_id").references(
      () => journalEntries.id,
    ),

    status: text("status", {
      enum: ["posted", "reversed"],
    })
      .notNull()
      .default("posted"),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by").references(() => users.id),
    reversalReason: text("reversal_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    index("idx_internal_debt_repay_party").on(t.partyId, t.occurredAt),
    index("idx_internal_debt_repay_outlet_date").on(t.outletId, t.occurredAt),
    check("ck_internal_debt_repay_amount_pos", sql`${t.amount} > 0`),
  ],
);
