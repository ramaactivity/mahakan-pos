import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  integer,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";
import { ingredients, inventoryMovements } from "./inventory";

/**
 * Stock opname session — one row per opname cycle (typically monthly,
 * start or end of month per Owner standard sesi N). Snapshot of expected
 * stock taken at start; staff fills actual_qty per line; manager
 * reviews + finalizes which writes batch adjust movements.
 *
 * Status lifecycle:
 *   in_progress → pending_review → completed
 *                ↘ in_progress (reopened by manager)
 *   in_progress → cancelled (manager only, snapshot kept for audit)
 *
 * total_diff_* are aggregate snapshots written on submit/finalize so
 * the list view doesn't need to re-aggregate lines for every render.
 */
export const stockOpnameSessions = pgTable(
  "stock_opname_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    status: text("status", {
      enum: ["in_progress", "pending_review", "completed", "cancelled"],
    })
      .notNull()
      .default("in_progress"),

    /** Human label like "April 2026" — also doubles as periode tag for
     * monthly cadence. Set on start, immutable. */
    periodLabel: text("period_label").notNull(),
    notes: text("notes"),

    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedBy: uuid("started_by")
      .notNull()
      .references(() => users.id),

    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    submittedBy: uuid("submitted_by").references(() => users.id),

    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    finalizedBy: uuid("finalized_by").references(() => users.id),

    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelReason: text("cancel_reason"),

    /** Aggregate snapshot — N total ingredient lines, sum of
     * |actual-expected|, sum of |actual-expected| × unit_cost.
     * Stamped on submit + finalize for fast list rendering. */
    totalLines: integer("total_lines").notNull().default(0),
    countedLines: integer("counted_lines").notNull().default(0),
    totalDiffQty: bigint("total_diff_qty", { mode: "number" })
      .notNull()
      .default(0),
    totalDiffCost: bigint("total_diff_cost", { mode: "number" })
      .notNull()
      .default(0),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_opname_sessions_outlet_status").on(t.outletId, t.status),
    index("idx_opname_sessions_outlet_started").on(t.outletId, t.startedAt),
    // Only one in-progress / pending_review session per outlet at a time —
    // prevents two staff starting overlapping opname cycles.
    uniqueIndex("ux_opname_sessions_active_per_outlet")
      .on(t.outletId)
      .where(sql`${t.status} IN ('in_progress', 'pending_review')`),
    check(
      "ck_opname_sessions_counted_le_total",
      sql`${t.countedLines} <= ${t.totalLines}`,
    ),
  ],
);

/**
 * Per-ingredient line within an opname session. expected_qty is captured
 * once at session start and never mutates; actual_qty is filled by staff
 * during count (autosaved). On finalize, lines with diff != 0 produce
 * one inventory_movement (kind='adjust') and movement_id is back-filled.
 */
export const stockOpnameLines = pgTable(
  "stock_opname_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => stockOpnameSessions.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),

    expectedQty: bigint("expected_qty", { mode: "number" }).notNull(),
    actualQty: bigint("actual_qty", { mode: "number" }),
    /** Cost per unit at time of session start — frozen so finalize cost
     * impact is reproducible even if cost_per_unit changes later. */
    unitCostAtSnapshot: bigint("unit_cost_at_snapshot", { mode: "number" })
      .notNull()
      .default(0),

    /** Snapshot ingredient name + unit — preserves history if the
     * ingredient is later renamed/soft-deleted. */
    ingredientNameSnapshot: text("ingredient_name_snapshot").notNull(),
    unitSnapshot: text("unit_snapshot").notNull(),

    note: text("note"),

    countedAt: timestamp("counted_at", { withTimezone: true }),
    countedBy: uuid("counted_by").references(() => users.id),

    /** Set on finalize — links to the adjust movement that committed
     * this line's diff. Null for lines with diff=0 (no movement created). */
    movementId: uuid("movement_id").references(() => inventoryMovements.id),
  },
  (t) => [
    uniqueIndex("ux_opname_lines_session_ingredient").on(
      t.sessionId,
      t.ingredientId,
    ),
    index("idx_opname_lines_session").on(t.sessionId),
    index("idx_opname_lines_ingredient").on(t.ingredientId),
    check("ck_opname_lines_expected_nonneg", sql`${t.expectedQty} >= 0`),
    check(
      "ck_opname_lines_actual_nonneg",
      sql`${t.actualQty} IS NULL OR ${t.actualQty} >= 0`,
    ),
  ],
);
