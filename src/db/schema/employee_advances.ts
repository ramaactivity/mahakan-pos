import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  date,
  index,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";
import { employees } from "./employees";
import { payrollPeriods } from "./hr";

/**
 * Sesi AE-60 — Kasbon (employee cash advance) audit trail.
 *
 * Owner kasih kasbon ke karyawan → buat row dengan status='pending'.
 * Saat compute payroll periode berikutnya, server auto-link advances
 * dengan status='pending' → mark 'deducted' + set deductedFromPeriodId,
 * dan payroll_lines.advance_deduction = SUM(amount per employee).
 *
 * Status workflow:
 *   - pending: kasbon baru di-issue, belum dikurangi gaji
 *   - deducted: sudah dikurangi dari payroll period tertentu
 *   - forgiven: owner forgive (kasbon dianggap lunas tanpa potong gaji)
 *
 * Tidak ada DELETE — semua kasbon di-track historical untuk audit.
 */
export const employeeAdvances = pgTable(
  "employee_advances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),

    /** Jumlah kasbon (Rp). Always > 0. */
    amount: bigint("amount", { mode: "number" }).notNull(),
    /** Alasan kasbon: "Bayar SPP anak", "Renovasi rumah", dll. Optional. */
    reason: text("reason"),
    /** Tanggal owner kasih kasbon (WIB). */
    issuedDate: date("issued_date").notNull(),

    /** Status workflow. Default 'pending' saat insert. */
    status: text("status", {
      enum: ["pending", "deducted", "forgiven"],
    })
      .notNull()
      .default("pending"),

    /** Set saat status='deducted' — period mana yang nge-pull kasbon ini. */
    deductedFromPeriodId: uuid("deducted_from_period_id").references(
      () => payrollPeriods.id,
    ),
    /** Timestamp kapan status berubah ke 'deducted' atau 'forgiven'. */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id),

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
    index("idx_employee_advances_employee").on(t.employeeId),
    index("idx_employee_advances_period").on(t.deductedFromPeriodId),
    index("idx_employee_advances_outlet_status").on(t.outletId, t.status),
    check("ck_employee_advances_amount_pos", sql`${t.amount} > 0`),
    check(
      "ck_employee_advances_resolve_consistency",
      sql`(${t.status} = 'pending' AND ${t.resolvedAt} IS NULL)
        OR (${t.status} != 'pending' AND ${t.resolvedAt} IS NOT NULL)`,
    ),
  ],
);
