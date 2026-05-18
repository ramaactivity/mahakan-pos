import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
  index,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";

/**
 * Sesi AE-62w — store-and-forward queue untuk failed journal posting hooks.
 *
 * Background: `fireJournalHook` di src/features/accounting/hooks.ts saat ini
 * fire-and-forget — kalau hook throw post-commit, audit `journal.posting_failed`
 * di-log tapi owner harus manual recover. Tidak ada mechanism untuk re-run.
 *
 * Solusi MVP: snapshot args + label saat enqueue (failure path), owner trigger
 * retry via Admin → Antrian Jurnal. Dispatcher di src/features/accounting/
 * retry-queue.ts validate args dengan zod schema per label, dispatch ke
 * original hook. recordJournal idempotency (UNIQUE ux_je_outlet_source_active
 * AE-62t) guarantee no duplicate post saat retry hit row yang sudah ter-post
 * via path lain.
 *
 * Status lifecycle:
 *   - pending: failure baru, belum retry
 *   - retrying: di-retry tapi gagal lagi (retryCount > 0, resolvedAt NULL)
 *   - resolved: retry sukses (resolvedAt + resolvedByUserId set)
 *   - abandoned: owner manual fix journal di tempat lain, abandon row
 *     (abandonedAt + reason set)
 *
 * Owner-visible. Permission journal_retry.* via RBAC matrix.
 */
export const journalRetryQueue = pgTable(
  "journal_retry_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    /** Label hook (matches fireJournalHook 2nd param). Dispatcher pakai
     * ini untuk routing ke hook function via switch. */
    hookLabel: text("hook_label").notNull(),

    /** JSON snapshot args yang dibutuhkan untuk re-invoke hook. Schema per
     * label di src/features/accounting/retry-queue.ts (zod validated). */
    hookArgs: jsonb("hook_args").notNull(),

    /** Source correlation (optional but helpful for owner UI search). */
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),

    /** Last error message (sanitized). */
    lastError: text("last_error").notNull(),
    /** Last error stack preview untuk owner debug. */
    lastErrorStack: text("last_error_stack"),

    /** Retry attempts so far. 0 = enqueued, never retried. */
    retryCount: integer("retry_count").notNull().default(0),
    lastRetryAt: timestamp("last_retry_at", { withTimezone: true }),
    lastRetryByUserId: uuid("last_retry_by_user_id").references(() => users.id),

    /** Resolved successfully via retry. */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id),
    /** Resulting journal entry id (kalau retry sukses). */
    resolvedJournalEntryId: uuid("resolved_journal_entry_id"),

    /** Owner mark abandon (manual fix elsewhere, no need to retry). */
    abandonedAt: timestamp("abandoned_at", { withTimezone: true }),
    abandonedByUserId: uuid("abandoned_by_user_id").references(() => users.id),
    abandonedReason: text("abandoned_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /** Hot lookup: pending rows per outlet (resolved + abandoned NULL). */
    index("idx_journal_retry_outlet_pending")
      .on(t.outletId)
      .where(sql`${t.resolvedAt} IS NULL AND ${t.abandonedAt} IS NULL`),
    index("idx_journal_retry_source").on(t.sourceType, t.sourceId),
    index("idx_journal_retry_created").on(t.createdAt),
    check("ck_journal_retry_count_nonneg", sql`${t.retryCount} >= 0`),
    /** Mutual-exclusive terminal states: tidak boleh resolved DAN abandoned. */
    check(
      "ck_journal_retry_terminal_xor",
      sql`NOT (${t.resolvedAt} IS NOT NULL AND ${t.abandonedAt} IS NOT NULL)`,
    ),
    /** Resolved pair: resolved_at + resolved_by must be set together. */
    check(
      "ck_journal_retry_resolved_pair",
      sql`(${t.resolvedAt} IS NULL AND ${t.resolvedByUserId} IS NULL) OR (${t.resolvedAt} IS NOT NULL AND ${t.resolvedByUserId} IS NOT NULL)`,
    ),
    /** Abandoned pair: abandoned_at + by + reason must be set together. */
    check(
      "ck_journal_retry_abandoned_pair",
      sql`(${t.abandonedAt} IS NULL AND ${t.abandonedByUserId} IS NULL AND ${t.abandonedReason} IS NULL)
       OR (${t.abandonedAt} IS NOT NULL AND ${t.abandonedByUserId} IS NOT NULL AND length(trim(${t.abandonedReason})) >= 3)`,
    ),
  ],
);
