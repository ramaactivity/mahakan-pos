import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  index,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";
import { creditors } from "./creditors";
import { bankAccounts } from "./bank-accounts";
import { journalEntries } from "./accounting";

/**
 * Sesi AE-80 — Repayment cicilan kreditur.
 *
 * 1 row per cicilan. `principalAmount` decrement creditor.principalOutstanding.
 * `interestAmount` adalah beban bunga periode ini (di-post ke 5301).
 *
 * Journal posted saat insert: Dr 2150 (pokok) + Dr 5301 (bunga, skip kalau 0)
 * / Cr <bank_account_code> (resolved from bankAccountId).
 *
 * Reversal: status='reversed' + post reversing journal (Cr 2150 / Dr Kas + Cr 5301).
 * Reversal creditor.principalOutstanding += principalAmount (restore).
 */
export const creditorRepayments = pgTable(
  "creditor_repayments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    creditorId: uuid("creditor_id")
      .notNull()
      .references(() => creditors.id),

    /** Bank source kas (FK ke bank_accounts). Resolver ke COA code via
     *  pattern existing di cashDeposit.ts mapping. */
    bankAccountId: uuid("bank_account_id")
      .notNull()
      .references(() => bankAccounts.id),

    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** Pokok yang dibayar periode ini (Rupiah). Decrement outstanding. */
    principalAmount: bigint("principal_amount", { mode: "number" }).notNull(),
    /** Bunga yang dibayar periode ini (Rupiah). Di-post ke 5301 expense. */
    interestAmount: bigint("interest_amount", { mode: "number" })
      .notNull()
      .default(0),

    description: text("description"),

    /** Link ke jurnal yang di-post. Idempotent via recordJournal
     *  sourceType='creditor_repayment' + sourceId=this.id. */
    journalEntryId: uuid("journal_entry_id").references(
      () => journalEntries.id,
    ),

    status: text("status", {
      enum: ["posted", "reversed"],
    })
      .notNull()
      .default("posted"),

    /** Reversal trail. */
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
    index("idx_creditor_repay_creditor").on(t.creditorId, t.occurredAt),
    index("idx_creditor_repay_outlet_date").on(t.outletId, t.occurredAt),
    check(
      "ck_creditor_repay_principal_nonneg",
      sql`${t.principalAmount} >= 0`,
    ),
    check(
      "ck_creditor_repay_interest_nonneg",
      sql`${t.interestAmount} >= 0`,
    ),
    /* Total wajib > 0 — minimal salah satu (pokok atau bunga) > 0. */
    check(
      "ck_creditor_repay_total_positive",
      sql`(${t.principalAmount} + ${t.interestAmount}) > 0`,
    ),
  ],
);
