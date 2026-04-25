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

export const shifts = pgTable(
  "shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),

    status: text("status", { enum: ["open", "closed"] })
      .notNull()
      .default("open"),
    openingCash: bigint("opening_cash", { mode: "number" }).notNull(),
    actualCash: bigint("actual_cash", { mode: "number" }),
    variance: bigint("variance", { mode: "number" }),

    notes: text("notes"),

    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_shifts_user_status").on(t.userId, t.status),
    index("idx_shifts_outlet_opened").on(t.outletId, t.openedAt),
    uniqueIndex("ux_shifts_user_active")
      .on(t.userId)
      .where(sql`${t.status} = 'open'`),
    check("ck_shifts_opening_nonneg", sql`${t.openingCash} >= 0`),
    check(
      "ck_shifts_actual_nonneg",
      sql`${t.actualCash} IS NULL OR ${t.actualCash} >= 0`,
    ),
    check(
      "ck_shifts_close_consistency",
      sql`(${t.status} = 'closed' AND ${t.closedAt} IS NOT NULL)
        OR (${t.status} = 'open' AND ${t.closedAt} IS NULL)`,
    ),
  ],
);
