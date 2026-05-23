import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    name: text("name").notNull(),
    email: text("email"),
    passwordHash: text("password_hash"),
    pinHash: text("pin_hash"),

    role: text("role", {
      enum: ["owner", "manager", "supervisor", "staff"],
    }).notNull(),
    status: text("status", { enum: ["active", "inactive"] })
      .notNull()
      .default("active"),

    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),

    /* Sesi AE-124 — quiet hours global per user untuk web push notif.
     * Stored sebagai minutes-of-day di WIB (0-1439). Default:
     *   start = 22:00 = 1320, end = 06:00 = 360.
     * Kalau start > end (mis. 22:00-06:00), window wrap melewati midnight.
     * Selama jam ini, sendCategorizedPush no-op (kecuali category SYSTEM
     * urgent — defined di helper). User bisa custom via Settings. */
    notificationQuietStartMin: integer("notification_quiet_start_min")
      .notNull()
      .default(1320),
    notificationQuietEndMin: integer("notification_quiet_end_min")
      .notNull()
      .default(360),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (t) => [
    uniqueIndex("ux_users_email_active")
      .on(t.email)
      .where(sql`${t.deletedAt} IS NULL AND ${t.email} IS NOT NULL`),
    index("idx_users_outlet_role").on(t.outletId, t.role),
    check("ck_users_auth", sql`${t.passwordHash} IS NOT NULL OR ${t.pinHash} IS NOT NULL`),
  ],
);
