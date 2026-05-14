import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";

/**
 * Sesi AE-56 — workflow status + catatan resolusi per channel per hari di
 * halaman Rekonsiliasi. Owner pakai untuk tandai selisih sudah di-investigate,
 * resolved, atau disputed. Mendukung audit trail multi-step (catatan +
 * resolved_by + timestamp).
 *
 * Unique constraint (outlet, channel, period_date) berarti 1 row per channel
 * per hari per outlet. Status workflow: open → investigating → resolved
 * atau disputed. Note bersifat free-form.
 */
export const reconciliationNotes = pgTable(
  "reconciliation_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    /** Channel: cash | edc_bca | qris | gofood | grabfood | shopeefood */
    channel: text("channel", {
      enum: ["cash", "edc_bca", "qris", "gofood", "grabfood", "shopeefood"],
    }).notNull(),
    /** WIB date YYYY-MM-DD untuk grouping per hari. */
    periodDate: date("period_date").notNull(),
    /** Workflow status. Default open saat baru dibuat. */
    status: text("status", {
      enum: ["open", "investigating", "resolved", "disputed"],
    })
      .notNull()
      .default("open"),
    /** Catatan free-form (max 2000 char di app layer). */
    note: text("note"),
    /** User yang men-set ke resolved (kalau ada). */
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),

    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_reconciliation_notes_scope").on(
      t.outletId,
      t.channel,
      t.periodDate,
    ),
    index("idx_reconciliation_notes_outlet_date").on(
      t.outletId,
      t.periodDate,
    ),
    check(
      "ck_reconciliation_notes_resolved_consistency",
      sql`(${t.status} = 'resolved' AND ${t.resolvedAt} IS NOT NULL)
        OR (${t.status} != 'resolved')`,
    ),
  ],
);
