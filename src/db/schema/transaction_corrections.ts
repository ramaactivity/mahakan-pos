import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  bigint,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { shifts } from "./shifts";
import { transactions } from "./transactions";
import { users } from "./users";

/**
 * Sesi AE-62r — per-transaction correction requests.
 *
 * Use case: kasir salah pilih paymentMethod atau salah input total nominal
 * di transaksi paid. Sebelum tutup shift, kasir bisa request koreksi langsung
 * di Riwayat (alternatif granular dari shift-level rebalance Phase 2/3).
 *
 * Workflow: kasir tap row → modal Detail → "Koreksi Transaksi" → form
 * (snapshot read-only + field baru + reason) → email kode 6-digit ke owner
 * → owner forward via WA → kasir input → server: atomic update trx + loyalty
 * re-calc + split delete+reinsert + journal reverse-then-repost + audit.
 *
 * Status lifecycle:
 *   pending_approval → approved (owner input kode valid)
 *                    ↘ rejected (owner reject)
 *                    ↘ cancelled (requester withdraw before approve)
 *
 * Journal flow saat approved (lihat postJournalForTransactionCorrection):
 *   1. Reverse original pos_sale entry (Dr↔Cr swap, COGS lines stripped)
 *   2. Post pos_sale_correction entry dengan corrected paymentMethod/total
 *      (COGS lines stripped — items unchanged)
 *
 * Window (sync dengan Phase 3 rebalance window):
 *   - 'kasir_active_shift': trx dari shift yang masih open
 *   - 'kasir_post_close': trx dari shift yang sudah closed <24h
 *   - 'manager_backoffice': dari /admin (future)
 */
export const transactionCorrections = pgTable(
  "transaction_corrections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    /** Snapshot shiftId saat request submitted — needed for window
     * re-validation at approve time (shift bisa di-close paksa antara
     * request & approve). */
    shiftIdAtRequest: uuid("shift_id_at_request")
      .notNull()
      .references(() => shifts.id),

    status: text("status", {
      enum: ["pending_approval", "approved", "rejected", "cancelled"],
    })
      .notNull()
      .default("pending_approval"),

    source: text("source", {
      enum: ["kasir_active_shift", "kasir_post_close", "manager_backoffice"],
    })
      .notNull()
      .default("kasir_active_shift"),

    // ============ Snapshot ORIGINAL values (pre-correction) ============
    originalPaymentMethod: text("original_payment_method").notNull(),
    originalTotal: bigint("original_total", { mode: "number" }).notNull(),
    originalSubtotal: bigint("original_subtotal", { mode: "number" }).notNull(),
    originalDiscountAmount: bigint("original_discount_amount", {
      mode: "number",
    }).notNull(),
    /** JSONB: array of { paymentMethod, amount, cashReceived?, cashChange? }
     * Snapshot dari splitPayments table saat request. Null jika originalPaymentMethod != 'split'. */
    originalSplitBreakdown: jsonb("original_split_breakdown"),
    originalLoyaltyPointsEarned: integer("original_loyalty_points_earned"),
    originalLoyaltyPointsRedeemed: integer("original_loyalty_points_redeemed"),

    // ============ CORRECTED values (kasir input) ============
    correctedPaymentMethod: text("corrected_payment_method").notNull(),
    correctedTotal: bigint("corrected_total", { mode: "number" }).notNull(),
    /** Derived server-side: subtotal - correctedTotal. Required for
     * ck_transactions_total_consistency. See Trap T11 di plan. */
    correctedDiscountAmount: bigint("corrected_discount_amount", {
      mode: "number",
    }).notNull(),
    /** JSONB: array of { paymentMethod, amount, cashReceived?, cashChange? }
     * Required if correctedPaymentMethod='split', else null. Sum must equal correctedTotal. */
    correctedSplitBreakdown: jsonb("corrected_split_breakdown"),

    // ============ Justification ============
    /** Alasan correction (kasir/owner). Wajib supaya audit trail jelas. */
    reason: text("reason").notNull(),
    /** Optional bukti screenshot foto. Drive URL. */
    photoUrl: text("photo_url"),

    // ============ Workflow timestamps + actors ============
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** Approval code yang dipakai untuk verify (link ke approval_codes). */
    approvalCodeId: uuid("approval_code_id"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),

    rejectedBy: uuid("rejected_by").references(() => users.id),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectedReason: text("rejected_reason"),

    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),

    // ============ Journal trail ============
    /** Original pos_sale journal entry untuk transaksi ini. */
    originalJournalEntryId: uuid("original_journal_entry_id"),
    /** pos_sale_reversal entry posted saat approval (Dr↔Cr swap, no COGS). */
    reverseJournalEntryId: uuid("reverse_journal_entry_id"),
    /** pos_sale_correction entry dengan corrected paymentMethod/total. */
    correctedJournalEntryId: uuid("corrected_journal_entry_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /** Only one pending correction per transaction — prevents racing
     * duplicate requests. After approve/reject/cancel, another can be created. */
    uniqueIndex("ux_transaction_corrections_pending_per_trx")
      .on(t.transactionId)
      .where(sql`${t.status} = 'pending_approval'`),
    index("idx_transaction_corrections_outlet_status").on(
      t.outletId,
      t.status,
    ),
    index("idx_transaction_corrections_transaction").on(t.transactionId),
    index("idx_transaction_corrections_requested_at").on(t.requestedAt),
    check(
      "ck_transaction_corrections_corrected_total_pos",
      sql`${t.correctedTotal} > 0`,
    ),
    check(
      "ck_transaction_corrections_corrected_discount_nonneg",
      sql`${t.correctedDiscountAmount} >= 0`,
    ),
    check(
      "ck_transaction_corrections_reason_nonempty",
      sql`length(trim(${t.reason})) >= 3`,
    ),
    /** correctedSplitBreakdown must be non-null iff correctedPaymentMethod='split'. */
    check(
      "ck_transaction_corrections_split_consistency",
      sql`(${t.correctedPaymentMethod} = 'split' AND ${t.correctedSplitBreakdown} IS NOT NULL)
       OR (${t.correctedPaymentMethod} != 'split' AND ${t.correctedSplitBreakdown} IS NULL)`,
    ),
  ],
);
