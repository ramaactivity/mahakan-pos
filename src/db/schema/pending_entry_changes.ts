import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";
import { shifts } from "./shifts";

/**
 * Sesi AE-67 — Pending Entry Change.
 *
 * Workflow staff-suggest → owner-approve untuk EDIT / DELETE entry
 * pengeluaran / pemasukan tunai. Pattern mirror `shift_rebalances`
 * (sesi AE-62o):
 *   1. Staff propose mutation (UPDATE / DELETE) di POS PettyCashCard
 *   2. Server generate 6-digit code → bcrypt hash → email ke owner
 *   3. Owner input kode di Back Office → atomic apply mutation
 *   4. Audit log: propose + approve / reject
 *
 * ADD (create new entry) TIDAK lewat sini — staff sudah punya perm
 * `expense.create` / `income.create` langsung via PettyCashCard (forward-safe,
 * sudah audit). Sesi AE-67 phase1: PettyCashCard extended dengan date
 * picker untuk retroactive ADD ke shift kemarin (tanpa approval).
 *
 * `pending_approval` ➞ `approved` / `rejected` / `cancelled` / `expired`.
 * Per (entity_type, entity_id), hanya 1 row active (status='pending_approval')
 * supaya tidak double-pending pada entry yang sama.
 */
export const pendingEntryChanges = pgTable(
  "pending_entry_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    /** Optional shift context — kalau proposal diajukan dari shift detail
     * modal atau POS Petty Cash, refer ke shift yang relevan. */
    shiftId: uuid("shift_id").references(() => shifts.id),

    status: text("status", {
      enum: [
        "pending_approval",
        "approved",
        "rejected",
        "cancelled",
        "expired",
      ],
    })
      .notNull()
      .default("pending_approval"),

    /** Operasi yang diusulkan. */
    operation: text("operation", {
      enum: ["update", "delete"],
    }).notNull(),

    /** Tipe entity. */
    entityType: text("entity_type", {
      enum: ["expense", "income"],
    }).notNull(),

    /** UUID entry yang akan di-modify. */
    entityId: uuid("entity_id").notNull(),

    /** Snapshot data SEBELUM perubahan (audit). Wajib supaya kita bisa
     * tampilkan diff old vs new di approval panel + rollback klarifikasi. */
    originalData: jsonb("original_data").notNull(),

    /** Data BARU yang diusulkan untuk operasi 'update'. Null untuk 'delete'.
     * Hanya field yang boleh di-update (amount, description, categoryId,
     * paymentMethod, expenseDate/incomeDate). */
    proposedData: jsonb("proposed_data"),

    /** Alasan kenapa propose (wajib min 3, untuk audit). */
    reason: text("reason").notNull(),

    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** Approval code yang dipakai (FK ke approval_codes.id, soft). */
    approvalCodeId: uuid("approval_code_id"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),

    rejectedBy: uuid("rejected_by").references(() => users.id),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectedReason: text("rejected_reason"),

    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),

    /** Expires_at deterministik: requestedAt + 24 jam.
     * Background sweep cron (atau lazy-evaluate saat list) bisa mark expired. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /** Hanya 1 row active per (entity_type, entity_id) — prevent
     * double-pending pada entry yang sama. Setelah resolved (approved/
     * rejected/cancelled/expired), bisa create proposal baru. */
    uniqueIndex("ux_pec_active_per_entity")
      .on(t.entityType, t.entityId)
      .where(sql`${t.status} = 'pending_approval'`),
    index("idx_pec_outlet_status").on(t.outletId, t.status),
    index("idx_pec_requested_by").on(t.requestedBy),
    index("idx_pec_requested_at").on(t.requestedAt),
    check(
      "ck_pec_reason_nonempty",
      sql`length(trim(${t.reason})) >= 3`,
    ),
    /** Untuk operasi 'update', proposedData WAJIB ada.
     * Untuk operasi 'delete', proposedData boleh null. */
    check(
      "ck_pec_proposed_data_for_update",
      sql`(${t.operation} = 'delete') OR (${t.operation} = 'update' AND ${t.proposedData} IS NOT NULL)`,
    ),
  ],
);
