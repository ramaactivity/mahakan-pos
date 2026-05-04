import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  date,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";

/**
 * HR employee master record (C-6 #C-6). Distinct from `users` (which is
 * the POS login account). One employee may or may not have a user
 * account — Owner adds an employee, then optionally links to a user
 * record so they can log in to POS / Back Office.
 *
 * Reasons for split:
 * - Some employees never need login (e.g. dishwasher, runner)
 * - Login users may include external integrations (e.g. owner of
 *   multi-outlet group whose primary employer is elsewhere)
 * - Personnel data (salary, NIK, address) doesn't belong on auth-scope
 *   table that's exposed to session machinery
 */
export const employees = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    // Identity
    fullName: text("full_name").notNull(),
    nickname: text("nickname"),
    /** KTP number — 16 digits in Indonesia. */
    nik: text("nik"),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    dateOfBirth: date("date_of_birth"),

    // Employment
    /** Owner-assigned internal ID (optional, e.g. "MK-001"). Unique
     * within outlet when set. */
    employeeNumber: text("employee_number"),
    /** Job title — Kasir, Barista, Server, Cook, Manager, etc. */
    position: text("position"),
    /** Department — Service, Kitchen, Bar, Office. */
    department: text("department"),
    hireDate: date("hire_date"),
    employmentType: text("employment_type", {
      enum: ["full_time", "part_time", "contract", "freelance"],
    }),
    /** Monthly base salary in rupiah; nullable for daily/freelance pay
     * tracking that's done elsewhere. */
    salaryAmount: bigint("salary_amount", { mode: "number" }),

    /** Optional link to a POS / Back Office login account. When set,
     * authn happens on the users row but HR ops use the employees row. */
    userId: uuid("user_id").references(() => users.id),

    // Status
    status: text("status", {
      enum: ["active", "on_leave", "resigned", "terminated"],
    })
      .notNull()
      .default("active"),
    resignedAt: timestamp("resigned_at", { withTimezone: true }),
    resignReason: text("resign_reason"),

    notes: text("notes"),

    /** Phase 4 (sesi AB) — bcrypt hash PIN untuk absensi mobile route
     * `/absenkaryawan`. Terpisah dari users.pin (POS staff PIN) supaya
     * karyawan kitchen/cleaning yang tidak punya akun POS tetap bisa
     * absensi. NULL = belum di-set; karyawan tidak bisa absen sampai
     * Owner/Manager set via Karyawan tab. */
    attendancePinHash: text("attendance_pin_hash"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    index("idx_employees_outlet").on(t.outletId),
    index("idx_employees_status").on(t.status),
    uniqueIndex("ux_employees_user_active")
      .on(t.userId)
      .where(sql`${t.userId} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    uniqueIndex("ux_employees_employee_number_outlet")
      .on(t.outletId, t.employeeNumber)
      .where(
        sql`${t.employeeNumber} IS NOT NULL AND ${t.deletedAt} IS NULL`,
      ),
    check(
      "ck_employees_salary_nonneg",
      sql`${t.salaryAmount} IS NULL OR ${t.salaryAmount} >= 0`,
    ),
  ],
);

/**
 * Per-employee career change log (sesi L). One row per promotion / role
 * change / salary adjustment / employment-type change. Auto-recorded by
 * `updateEmployee` action when relevant fields change; Owner can also
 * manually add entries (e.g. backfill historical promotions).
 *
 * Append-only — never edit/delete history rows. Soft-delete only via
 * deletedAt (rare, for accidental insert).
 */
export const employeeCareerHistory = pgTable(
  "employee_career_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** Effective date — when this position/salary started. Defaults to
     * change-detection time, but Owner can backfill for manual entries. */
    effectiveDate: date("effective_date").notNull(),

    // Snapshot of the role at this point in time
    position: text("position"),
    department: text("department"),
    employmentType: text("employment_type", {
      enum: ["full_time", "part_time", "contract", "freelance"],
    }),
    salaryAmount: bigint("salary_amount", { mode: "number" }),

    /** Free-form note: "Promosi ke Head Bar", "Naik gaji performance review", etc. */
    note: text("note"),
    /** Source of the entry: 'auto' = system-detected change; 'manual' = Owner-entered. */
    source: text("source", { enum: ["auto", "manual"] })
      .notNull()
      .default("auto"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    index("idx_employee_career_history_employee").on(
      t.employeeId,
      t.effectiveDate,
    ),
    check(
      "ck_employee_career_history_salary_nonneg",
      sql`${t.salaryAmount} IS NULL OR ${t.salaryAmount} >= 0`,
    ),
  ],
);

/**
 * HR docs metadata. Phase 1 stores file_url as plain text — actual file
 * uploads (KTP scan, contracts) defer to a future sesi. Useful right
 * now for tracking expiry dates (KTP, BPJS, contracts) so Owner can
 * follow up before they lapse.
 */
export const employeeDocuments = pgTable(
  "employee_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    docType: text("doc_type", {
      enum: [
        "ktp",
        "bpjs_kesehatan",
        "bpjs_ketenagakerjaan",
        "npwp",
        "ijazah",
        "kontrak",
        "other",
      ],
    }).notNull(),
    /** Free-form label e.g. "KTP Galih Pratama", "Kontrak 2026 renewal". */
    title: text("title").notNull(),
    /** Optional file pointer (e.g. cloud storage URL). Phase 1 manual. */
    fileUrl: text("file_url"),
    /** Optional expiry — surfaced in HR dashboard as warning when near. */
    expiresAt: date("expires_at"),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    index("idx_employee_documents_employee").on(t.employeeId),
    index("idx_employee_documents_expires").on(t.expiresAt),
  ],
);
