import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  index,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";
import { transactions } from "./transactions";

/**
 * Owner-issued one-time approval codes for void/refund. Generated on
 * staff/manager request → emailed to Owner → Owner forwards via WA →
 * staff inputs at POS → server consumes by bcrypt-comparing the input
 * against `code_hash`.
 *
 * Single-use enforced via `consumed_at` (NULL until consumed). Expiry
 * defaults to NOW() + 10 min (set explicitly on insert; the column has
 * no DEFAULT so each issuance can decide TTL). Brute-force resistance
 * via per-row `failed_attempts` counter; lockout policy enforced in
 * action layer.
 *
 * `code_first_two` is a UI display hint only — Owner sees "Active code
 * starting with 73…" in admin panel without the full code being readable.
 * Never sent to staff for verification (always require full 6-digit input).
 */
export const approvalCodes = pgTable(
  "approval_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** bcrypt cost-10 hash of the 6-digit code */
    codeHash: text("code_hash").notNull(),
    /** First two digits of the plaintext code — UI display hint only.
     * Never used for verification. Helps Owner distinguish active codes. */
    codeFirstTwo: text("code_first_two").notNull(),

    actionType: text("action_type", {
      enum: [
        "pos.transaction.void",
        "pos.transaction.refund",
        /* Sesi AE-62o — shift rebalancing dengan owner approval.
         * Target = shift_rebalances.id (not transaction). */
        "shift.rebalance",
        /* Sesi AE-62r — per-transaction correction (paymentMethod/total swap).
         * Target = transaction_corrections.id (not transaction itself —
         * separate target column to keep idx_approval_codes_lookup uncontested
         * when a trx happens to have both a pending void code and a pending
         * correction code). */
        "pos.transaction.correction",
        /* Sesi AE-67 — pengeluaran / pemasukan entry change (edit/delete).
         * Target = pending_entry_changes.id. Pattern mirror shift.rebalance. */
        "entry_change",
        /* Sesi AE-195 — compliment (transaksi 100% gratis) wajib approval
         * owner. SATU-SATUNYA action type TANPA target entity: compliment
         * diminta saat keranjang masih di layar, transaksinya belum ada.
         * Pengaman penggantinya: scope outlet + sekali pakai + TTL, dan kode
         * hanya berlaku untuk actionType ini. */
        "pos.compliment",
      ],
    }).notNull(),

    /** Transaction this code authorizes — prevents code laundering across
     * unrelated transactions. NULLABLE per sesi AE-62o supaya bisa target
     * non-transaction entities (mis. shift_rebalances). CHECK constraint
     * enforce exactly satu target di-set sesuai action_type. */
    targetTransactionId: uuid("target_transaction_id").references(
      () => transactions.id,
    ),

    /** Sesi AE-62o — alternative target untuk action_type='shift.rebalance'. */
    targetShiftRebalanceId: uuid("target_shift_rebalance_id"),

    /** Sesi AE-62r — alternative target untuk action_type='pos.transaction.correction'.
     * Separate dari targetTransactionId supaya idx_approval_codes_lookup
     * (yang index targetTransactionId) tidak collide saat trx punya pending
     * void code DAN pending correction code bersamaan. */
    targetTransactionCorrectionId: uuid("target_transaction_correction_id"),

    /** Sesi AE-67 — target untuk action_type='entry_change'. Refer ke
     * pending_entry_changes.id. */
    targetEntryChangeId: uuid("target_entry_change_id"),

    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    /** Staff/manager who initiated the request (audit trail). */
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id),

    /** Reason staff entered when requesting. Echoed in email body. */
    reason: text("reason").notNull(),

    /** Wall-clock expiry. Set explicitly on insert (typical 10 min). */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    /** NULL until consumed; set with `consumed_by_user_id` when staff submits. */
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    consumedByUserId: uuid("consumed_by_user_id").references(() => users.id),

    /** Brute-force counter. Lockout enforced at 3 failures within 60s
     * (logic in action layer; this column is the source of truth). */
    failedAttempts: integer("failed_attempts").notNull().default(0),

    /**
     * Sesi AE-195 — transaksi yang akhirnya memakai kode ini.
     *
     * Khusus `pos.compliment`: kodenya dikonsumsi di modal (biar kasir tahu
     * salah/benar saat itu juga), lalu ditautkan ke transaksinya saat bayar.
     * Tautan ini yang mencegah SATU kode dipakai untuk beberapa compliment,
     * sekaligus jadi jejak audit "compliment ini disetujui lewat kode mana".
     */
    usedForTransactionId: uuid("used_for_transaction_id").references(
      () => transactions.id,
    ),

    /**
     * Sesi AE-196 — nilai keranjang yang disetujui owner (rupiah).
     *
     * Khusus `pos.compliment`: kode diminta saat transaksinya belum ada, jadi
     * satu-satunya cara mengikat kode ke besaran yang benar-benar disetujui
     * adalah menyimpan subtotal saat permintaan dikirim. Tanpa ini kode yang
     * disetujui untuk keranjang Rp 20rb bisa dipakai menggratiskan Rp 2 juta.
     * NULL = kode lama (sebelum AE-196) atau action type lain → tidak dicek.
     */
    approvedAmount: bigint("approved_amount", { mode: "number" }),

    /** Owner can revoke a code before consumption. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: uuid("revoked_by_user_id").references(() => users.id),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /** Active-code lookup hot path: find unused, unrevoked, unexpired
     * codes for a specific (transaction, action). */
    index("idx_approval_codes_lookup").on(
      t.targetTransactionId,
      t.actionType,
      t.consumedAt,
    ),
    /** Owner admin panel lookup: outlet + recent codes. */
    index("idx_approval_codes_outlet_created").on(t.outletId, t.createdAt),
    /** code_first_two must match the plaintext code's first two chars,
     * always exactly 2 digits. */
    check(
      "ck_approval_codes_first_two_format",
      sql`${t.codeFirstTwo} ~ '^[0-9]{2}$'`,
    ),
    /** failed_attempts non-negative. */
    check(
      "ck_approval_codes_failed_attempts_nonneg",
      sql`${t.failedAttempts} >= 0`,
    ),
    /** consumed_at + consumed_by_user_id must be set/cleared together. */
    check(
      "ck_approval_codes_consumed_pair",
      sql`(${t.consumedAt} IS NULL AND ${t.consumedByUserId} IS NULL) OR (${t.consumedAt} IS NOT NULL AND ${t.consumedByUserId} IS NOT NULL)`,
    ),
    /** revoked_at + revoked_by_user_id same pairing. */
    check(
      "ck_approval_codes_revoked_pair",
      sql`(${t.revokedAt} IS NULL AND ${t.revokedByUserId} IS NULL) OR (${t.revokedAt} IS NOT NULL AND ${t.revokedByUserId} IS NOT NULL)`,
    ),
    /** Sesi AE-67 — exactly one target set per action_type (4-way XOR).
     * Extends AE-62r 3-way (void/refund/rebalance/correction) with 4th path
     * (entry_change). */
    check(
      "ck_approval_codes_target_xor",
      sql`(${t.actionType} IN ('pos.transaction.void','pos.transaction.refund')
            AND ${t.targetTransactionId} IS NOT NULL
            AND ${t.targetShiftRebalanceId} IS NULL
            AND ${t.targetTransactionCorrectionId} IS NULL
            AND ${t.targetEntryChangeId} IS NULL)
       OR (${t.actionType} = 'shift.rebalance'
            AND ${t.targetShiftRebalanceId} IS NOT NULL
            AND ${t.targetTransactionId} IS NULL
            AND ${t.targetTransactionCorrectionId} IS NULL
            AND ${t.targetEntryChangeId} IS NULL)
       OR (${t.actionType} = 'pos.transaction.correction'
            AND ${t.targetTransactionCorrectionId} IS NOT NULL
            AND ${t.targetTransactionId} IS NULL
            AND ${t.targetShiftRebalanceId} IS NULL
            AND ${t.targetEntryChangeId} IS NULL)
       OR (${t.actionType} = 'entry_change'
            AND ${t.targetEntryChangeId} IS NOT NULL
            AND ${t.targetTransactionId} IS NULL
            AND ${t.targetShiftRebalanceId} IS NULL
            AND ${t.targetTransactionCorrectionId} IS NULL)
       /* Sesi AE-195 — compliment: SEMUA target NULL. Transaksinya belum
        * ada saat kode diminta, jadi tidak ada baris yang bisa ditunjuk. */
       OR (${t.actionType} = 'pos.compliment'
            AND ${t.targetTransactionId} IS NULL
            AND ${t.targetShiftRebalanceId} IS NULL
            AND ${t.targetTransactionCorrectionId} IS NULL
            AND ${t.targetEntryChangeId} IS NULL)`,
    ),
    /** Sesi AE-62r — fast lookup of active correction codes. */
    index("idx_approval_codes_correction_lookup").on(
      t.targetTransactionCorrectionId,
      t.actionType,
      t.consumedAt,
    ),
    /** Sesi AE-67 — fast lookup of active entry_change codes. */
    index("idx_approval_codes_entry_change_lookup").on(
      t.targetEntryChangeId,
      t.actionType,
      t.consumedAt,
    ),
  ],
);
