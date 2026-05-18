import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { shifts } from "./shifts";
import { users } from "./users";

/**
 * Sesi AE-62o — shift rebalance requests.
 *
 * Use case: kasir close shift dengan variance (mis. salah pencet metode
 * pembayaran), atau manager backoffice discover kesalahan post-close.
 * Workflow: kasir/manager request correction → email code dikirim ke owner
 * → owner approve via 6-digit code → shift fields + journals di-adjust
 * dengan corrected values.
 *
 * Status lifecycle:
 *   pending_approval → approved (kasir/manager applies correction)
 *                    ↘ rejected (owner says no)
 *                    ↘ cancelled (requester withdraw before approve)
 *
 * Journal flow saat approved:
 *   1. Reverse original shift_variance entry (kalau variance lama != 0)
 *   2. Post new shift_variance entry dengan corrected variance (kalau != 0)
 *
 * Source of request:
 *   - 'close_shift': kasir tap "Ajukan Rebalancing" dari ShiftPanel setelah
 *     close shift dengan variance > threshold
 *   - 'manager_backoffice': manager di ShiftDetailModal "Suggest Correction"
 */
export const shiftRebalances = pgTable(
  "shift_rebalances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => shifts.id),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    status: text("status", {
      enum: ["pending_approval", "approved", "rejected", "cancelled"],
    })
      .notNull()
      .default("pending_approval"),

    /** Source: 'close_shift' (kasir saat close) | 'manager_backoffice' (post-close). */
    source: text("source", {
      enum: ["close_shift", "manager_backoffice"],
    })
      .notNull()
      .default("close_shift"),

    // ============ Snapshot ORIGINAL values (pre-correction) ============
    /** shift.actualCash saat request submitted. */
    originalActualCash: bigint("original_actual_cash", { mode: "number" }).notNull(),
    /** shift.variance saat request submitted (cash variance). */
    originalVariance: bigint("original_variance", { mode: "number" }).notNull(),
    /** Nullable untuk legacy shifts pre-AE-56. */
    originalQrisSettlement: bigint("original_qris_settlement", {
      mode: "number",
    }),
    originalEdcSettlement: bigint("original_edc_settlement", {
      mode: "number",
    }),

    // ============ CORRECTED values (kasir/manager input) ============
    correctedActualCash: bigint("corrected_actual_cash", {
      mode: "number",
    }).notNull(),
    correctedQrisSettlement: bigint("corrected_qris_settlement", {
      mode: "number",
    }),
    correctedEdcSettlement: bigint("corrected_edc_settlement", {
      mode: "number",
    }),
    /** Computed at approval time: corrected_actual_cash - expectedCash
     * (expectedCash = openingCash + paidCash - refundedCash - pettyExpenseCash
     * + pettyIncomeCash, sama formula dengan closeShift). */
    correctedVariance: bigint("corrected_variance", { mode: "number" }),

    // ============ Justification ============
    /** Alasan correction (kasir/manager). Wajib supaya audit trail jelas. */
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
    /** Original shift_variance journal entry (kalau ada — variance lama != 0). */
    originalJournalEntryId: uuid("original_journal_entry_id"),
    /** Reverse entry posted saat approval (mirror sesi AE-62h pattern). */
    reverseJournalEntryId: uuid("reverse_journal_entry_id"),
    /** New shift_variance entry dengan corrected values. */
    correctedJournalEntryId: uuid("corrected_journal_entry_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /** Only one pending rebalance per shift — prevents racing duplicate
     * requests. After approve/reject/cancel, another can be created. */
    uniqueIndex("ux_shift_rebalances_pending_per_shift")
      .on(t.shiftId)
      .where(sql`${t.status} = 'pending_approval'`),
    index("idx_shift_rebalances_outlet_status").on(t.outletId, t.status),
    index("idx_shift_rebalances_shift").on(t.shiftId),
    index("idx_shift_rebalances_requested_at").on(t.requestedAt),
    check(
      "ck_shift_rebalances_corrected_cash_nonneg",
      sql`${t.correctedActualCash} >= 0`,
    ),
    check(
      "ck_shift_rebalances_reason_nonempty",
      sql`length(trim(${t.reason})) >= 3`,
    ),
  ],
);
