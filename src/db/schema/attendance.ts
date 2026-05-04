import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  date,
  doublePrecision,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";
import { employees } from "./employees";

/**
 * Daily attendance log per employee (Sesi C-7). One row per (employee,
 * shift_date). Captures clock_in_at + clock_out_at as raw timestamps;
 * late + overtime computed at display time so threshold tweaks don't
 * require backfill.
 *
 * Open record = clock_out_at IS NULL (employee still on the floor).
 * Same employee can't have two open records on the same date — enforced
 * by partial-unique index.
 *
 * Phase 4 (sesi AB) — extended dengan selfie + GPS metadata + idempotency
 * untuk mobile flow `/absenkaryawan`. Legacy kiosk records dari sesi C7
 * leave these NULL.
 */
export const attendanceRecords = pgTable(
  "attendance_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),

    /** Logical work-day. Derived from clock_in_at in WIB; allows pre-
     * midnight + post-midnight clock-out for shifts crossing the day
     * boundary without splitting the record. */
    shiftDate: date("shift_date").notNull(),

    clockInAt: timestamp("clock_in_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    clockOutAt: timestamp("clock_out_at", { withTimezone: true }),

    /** Computed at clock-in if outlet has expected_open_time configured.
     * Stored as a denormalized snapshot so reports don't recompute. */
    isLate: text("is_late", { enum: ["yes", "no", "unknown"] })
      .notNull()
      .default("unknown"),
    lateMinutes: integer("late_minutes"),

    /** Computed at clock-out if outlet has expected_close_time. */
    overtimeMinutes: integer("overtime_minutes"),
    /** Working duration in minutes (clock_out - clock_in). Computed at
     * clock-out, denormalized for report queries. */
    workMinutes: integer("work_minutes"),

    notes: text("notes"),

    /** Phase 4 (sesi AB) — selfie URL/ID dari Drive ABSENSI/{Nama}/{date}/.
     * NULL untuk legacy records dari kiosk admin (sesi C7) atau mobile flow
     * yang gagal upload Drive. */
    selfieDriveUrl: text("selfie_drive_url"),
    selfieDriveFileId: text("selfie_drive_file_id"),

    /** Phase 4 — GPS coords karyawan saat absen (mobile flow only).
     * Distance dihitung saat insert pakai haversine vs outlet center;
     * disimpan untuk audit trail. */
    gpsLat: doublePrecision("gps_lat"),
    gpsLng: doublePrecision("gps_lng"),
    gpsDistanceMeters: integer("gps_distance_meters"),

    /** Phase 4 — idempotency token untuk mobile clock-in/out. Dedup window
     * 60s server-side cegah double-tap dari karyawan. NULL untuk kiosk. */
    clientRefId: uuid("client_ref_id"),

    /** User who tapped Clock In on the kiosk (typically Manager/Owner
     * stewarding the device, or the employee themselves if they have
     * their own login). */
    clockedInBy: uuid("clocked_in_by")
      .notNull()
      .references(() => users.id),
    clockedOutBy: uuid("clocked_out_by").references(() => users.id),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_attendance_outlet_date").on(t.outletId, t.shiftDate),
    index("idx_attendance_employee_date").on(t.employeeId, t.shiftDate),
    index("idx_attendance_client_ref")
      .on(t.clientRefId)
      .where(sql`${t.clientRefId} IS NOT NULL`),
    uniqueIndex("ux_attendance_open_per_employee_date")
      .on(t.employeeId, t.shiftDate)
      .where(sql`${t.clockOutAt} IS NULL`),
    check(
      "ck_attendance_clock_order",
      sql`${t.clockOutAt} IS NULL OR ${t.clockOutAt} >= ${t.clockInAt}`,
    ),
    check(
      "ck_attendance_minutes_nonneg",
      sql`(${t.lateMinutes} IS NULL OR ${t.lateMinutes} >= 0)
        AND (${t.overtimeMinutes} IS NULL OR ${t.overtimeMinutes} >= 0)
        AND (${t.workMinutes} IS NULL OR ${t.workMinutes} >= 0)`,
    ),
  ],
);
