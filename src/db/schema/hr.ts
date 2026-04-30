import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  integer,
  boolean,
  date,
  time,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";
import { employees } from "./employees";

/**
 * Per-employee per-date scheduled work hours (Sesi C-8).
 *
 * `day_off=true` means the employee is off that day; start_time +
 * end_time are NULL. Otherwise both are set with end_time > start_time
 * (or wraps past midnight, captured as end_time < start_time — still
 * a valid schedule for closing-shift bartenders).
 *
 * Late + overtime detection in `attendance.actions.clockIn/clockOut`
 * looks up this row and populates the denormalized cols on
 * `attendance_records`. Grace period (default 5 min) is per-outlet
 * configurable; for now hardcoded constant in attendance/actions.ts.
 */
export const employeeSchedules = pgTable(
  "employee_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    scheduleDate: date("schedule_date").notNull(),

    startTime: time("start_time"),
    endTime: time("end_time"),
    dayOff: boolean("day_off").notNull().default(false),

    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("ux_schedules_employee_date").on(t.employeeId, t.scheduleDate),
    index("idx_schedules_outlet_date").on(t.outletId, t.scheduleDate),
    check(
      "ck_schedules_times_consistency",
      sql`(${t.dayOff} = true AND ${t.startTime} IS NULL AND ${t.endTime} IS NULL)
        OR (${t.dayOff} = false AND ${t.startTime} IS NOT NULL AND ${t.endTime} IS NOT NULL)`,
    ),
  ],
);

/**
 * A payroll run for a date range. Lifecycle:
 *   draft → finalized (Owner reviews + locks)
 *   finalized → paid (Owner records actual disbursement)
 * Once finalized, lines should be immutable (enforced server-side at
 * action layer; not via constraint to allow Owner-only override).
 */
export const payrollPeriods = pgTable(
  "payroll_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    /** Inclusive period bounds. */
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    /** Free-form label e.g. "April 2026", "Bonus Lebaran 2026". */
    label: text("label").notNull(),
    status: text("status", { enum: ["draft", "finalized", "paid"] })
      .notNull()
      .default("draft"),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    finalizedBy: uuid("finalized_by").references(() => users.id),
    paidBy: uuid("paid_by").references(() => users.id),
  },
  (t) => [
    index("idx_payroll_periods_outlet").on(t.outletId, t.periodStart),
    check(
      "ck_payroll_period_range",
      sql`${t.periodEnd} >= ${t.periodStart}`,
    ),
  ],
);

/**
 * Per-employee per-period payroll line. Computed from attendance +
 * employee.salary_amount when the period is recomputed via
 * `computePayrollLines` action. Owner can override individual fields
 * before finalize via `updatePayrollLine`.
 *
 * All money fields in rupiah. All minutes fields denormalized snapshot
 * of the attendance aggregation at compute time — re-running compute
 * overwrites them.
 */
export const payrollLines = pgTable(
  "payroll_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    periodId: uuid("period_id")
      .notNull()
      .references(() => payrollPeriods.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),

    /** Snapshot at compute time — Owner sees what salary was when. */
    baseSalary: bigint("base_salary", { mode: "number" }).notNull().default(0),
    /** Days the employee had at least one closed attendance record. */
    workDays: integer("work_days").notNull().default(0),
    /** Sum of work_minutes across closed attendance records. */
    totalWorkMinutes: integer("total_work_minutes").notNull().default(0),
    totalLateMinutes: integer("total_late_minutes").notNull().default(0),
    totalOvertimeMinutes: integer("total_overtime_minutes")
      .notNull()
      .default(0),

    /** Owner-editable money fields. Defaults from naive computation. */
    overtimePay: bigint("overtime_pay", { mode: "number" })
      .notNull()
      .default(0),
    lateDeduction: bigint("late_deduction", { mode: "number" })
      .notNull()
      .default(0),
    bonus: bigint("bonus", { mode: "number" }).notNull().default(0),
    /** Generic deductions (BPJS, kasbon, etc.). */
    otherDeductions: bigint("other_deductions", { mode: "number" })
      .notNull()
      .default(0),

    /** Computed: base + overtime + bonus - late - other. Server keeps
     * in sync on every save. */
    grossPay: bigint("gross_pay", { mode: "number" }).notNull().default(0),
    netPay: bigint("net_pay", { mode: "number" }).notNull().default(0),

    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_payroll_lines_period_employee").on(
      t.periodId,
      t.employeeId,
    ),
    index("idx_payroll_lines_employee").on(t.employeeId),
    check(
      "ck_payroll_lines_money_nonneg",
      sql`${t.baseSalary} >= 0
        AND ${t.overtimePay} >= 0
        AND ${t.lateDeduction} >= 0
        AND ${t.bonus} >= 0
        AND ${t.otherDeductions} >= 0`,
    ),
  ],
);
