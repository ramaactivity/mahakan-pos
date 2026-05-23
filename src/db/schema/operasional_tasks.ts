import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";

/**
 * Sesi AE-131 — Operasional Checklist module.
 *
 * Owner/Manager mendefinisikan daftar tugas operasional (template) per
 * section (bar/kitchen/general) per frequency (daily/weekly/monthly).
 * Staff ceklist tugas tersebut secara kolaboratif — siapa pun di shift
 * yang sedang aktif bisa menandai task selesai; auto-save kapan saja
 * dalam jendela waktu (pagi/siang/malam, sebelum/sesudah tutup).
 *
 * Period key per frequency:
 *   - daily:    YYYY-MM-DD (Asia/Jakarta)
 *   - weekly:   YYYY-Www  (ISO week, Monday-anchored)
 *   - monthly:  YYYY-MM
 *
 * Anti-double: unique (template_id, period_key). Toggle off = soft-delete
 * via completedAt set null (atau hard delete completion row — kita pilih
 * hard delete supaya unique index tetap valid). Late mark = upsert dengan
 * is_late=true + late_reason.
 */

export const operasionalTaskTemplates = pgTable(
  "operasional_task_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    section: text("section", { enum: ["bar", "kitchen", "general"] }).notNull(),
    frequency: text("frequency", {
      enum: ["daily", "weekly", "monthly"],
    }).notNull(),
    title: text("title").notNull(),
    description: text("description"),
    displayOrder: integer("display_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    /** True kalau row hasil seed default (untuk UI label "default"). */
    isSeed: boolean("is_seed").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    index("idx_op_task_templates_outlet_freq_section").on(
      t.outletId,
      t.frequency,
      t.section,
    ),
    index("idx_op_task_templates_active_order").on(
      t.outletId,
      t.isActive,
      t.displayOrder,
    ),
    check(
      "ck_op_task_templates_title_nonempty",
      sql`length(trim(${t.title})) > 0`,
    ),
  ],
);

export const operasionalTaskCompletions = pgTable(
  "operasional_task_completions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    templateId: uuid("template_id")
      .notNull()
      .references(() => operasionalTaskTemplates.id, { onDelete: "cascade" }),
    /** Denormalized for fast filter (also matches template.frequency). */
    frequency: text("frequency", {
      enum: ["daily", "weekly", "monthly"],
    }).notNull(),
    /** YYYY-MM-DD / YYYY-Www / YYYY-MM (WIB). */
    periodKey: text("period_key").notNull(),

    completedAt: timestamp("completed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedBy: uuid("completed_by")
      .notNull()
      .references(() => users.id),

    /** Backdated ceklist (period_key adalah past period). */
    isLate: boolean("is_late").notNull().default(false),
    lateReason: text("late_reason"),
    /** Optional note from the completer. */
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_op_task_completions_template_period").on(
      t.templateId,
      t.periodKey,
    ),
    index("idx_op_task_completions_outlet_period").on(
      t.outletId,
      t.frequency,
      t.periodKey,
    ),
  ],
);

/**
 * Audit ringan kapan staff/manager menekan tombol "Kirim ke WA Grup"
 * untuk ringkasan checklist. Sekadar tampilan info "Dikirim X jam lalu".
 */
export const operasionalTaskWaExports = pgTable(
  "operasional_task_wa_exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    frequency: text("frequency", {
      enum: ["daily", "weekly", "monthly"],
    }).notNull(),
    /** Mengikat ke (frequency, period_key, section?) — section nullable
     * supaya satu push WA bisa mencakup semua section (daily/monthly). */
    section: text("section", { enum: ["bar", "kitchen", "general"] }),
    periodKey: text("period_key").notNull(),
    exportedAt: timestamp("exported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    exportedBy: uuid("exported_by")
      .notNull()
      .references(() => users.id),
    /** Snapshot count untuk audit trail (X / Y task done saat dikirim). */
    completedCount: integer("completed_count").notNull(),
    totalCount: integer("total_count").notNull(),
  },
  (t) => [
    index("idx_op_task_wa_exports_outlet_period").on(
      t.outletId,
      t.frequency,
      t.periodKey,
    ),
  ],
);

export type OperasionalTaskTemplate =
  typeof operasionalTaskTemplates.$inferSelect;
export type OperasionalTaskCompletion =
  typeof operasionalTaskCompletions.$inferSelect;
export type OperasionalTaskWaExport =
  typeof operasionalTaskWaExports.$inferSelect;

export type OperasionalSection = "bar" | "kitchen" | "general";
export type OperasionalFrequency = "daily" | "weekly" | "monthly";
