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
import { investors } from "./investors";
import { bankAccounts } from "./bank-accounts";
import { journalEntries } from "./accounting";
import { capitalMovements } from "./capital_movements";

/**
 * Sesi AE-80 — Withdrawal pencairan saldo dividen investor.
 *
 * Owner-only flow, direct (no pending state per user decision). Modal di
 * Tab Saldo & Pencairan: input nominal + bank source → confirm → post.
 *
 * Validation:
 *  - amount >= 50_000 (CHECK constraint + UI input min)
 *  - amount <= investor.dividend_balance (service pre-check)
 *  - amount <= bank balance via getAccountBalance (service pre-check)
 *
 * Atomicity (db.transaction):
 *  1. SELECT FOR UPDATE investor + advisory lock bank account
 *  2. Insert withdrawal_requests + recordJournal sourceType='dividend_withdrawal'
 *  3. Insert capital_movements kind='dividend_withdrawal'
 *  4. UPDATE investor.dividend_balance -= amount (CHECK >= 0 last defense)
 *
 * Reversal: status='reversed' + reverseWithdrawal action restore balance +
 * post reversing journal.
 */
export const withdrawalRequests = pgTable(
  "withdrawal_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    investorId: uuid("investor_id")
      .notNull()
      .references(() => investors.id),

    /** Nominal pencairan (Rupiah). Min Rp 50.000 via CHECK. */
    amount: bigint("amount", { mode: "number" }).notNull(),

    /** Bank sumber kas. Resolver ke COA code via pattern existing. */
    bankAccountId: uuid("bank_account_id")
      .notNull()
      .references(() => bankAccounts.id),

    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    description: text("description"),

    /** Link ke jurnal (Dr 3202 / Cr Bank). */
    journalEntryId: uuid("journal_entry_id").references(
      () => journalEntries.id,
    ),
    /** Link ke capital_movements row (kind='dividend_withdrawal'). */
    capitalMovementId: uuid("capital_movement_id").references(
      () => capitalMovements.id,
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
    index("idx_withdrawal_outlet_date").on(t.outletId, t.occurredAt),
    index("idx_withdrawal_investor").on(t.investorId, t.occurredAt),
    /* Sesi AE-80 — min Rp 50.000 per user requirement. */
    check("ck_withdrawal_min_amount", sql`${t.amount} >= 50000`),
  ],
);
