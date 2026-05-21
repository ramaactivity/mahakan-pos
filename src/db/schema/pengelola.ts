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
 * Sesi AE-63a — Pengelola Mahakan Coffee (5 manager + shareholder).
 *
 * Entitas TERPISAH dari `employees` per owner directive: pengelola
 * adalah shareholder yang juga jalanin operasional, semua kompensasi
 * mereka via dividen (bukan gaji bulanan via payroll). Phase 1 mereka
 * TIDAK linked ke employees — kalau future owner mau pengelola dapat
 * gaji juga, tambah `employeeId` FK opsional.
 *
 * Daftar pengelola Mahakan 2026 (dari Sheets):
 *  1. Anisa Amalia (modal Rp 1,700,000 — 10.23% pengelola pool)
 *  2. Intan Nabila (modal Rp 2,000,000 — 11.90%)
 *  3. Muhamad Bayu Kurnia (modal Rp 2,000,000 — 11.54%)
 *  4. Muhaman Sekal Maulidan (modal Rp 3,500,000 — 45.60%)
 *  5. Muhamad Ramadan Saputra (modal Rp 3,400,000 — 20.71%)
 *
 * Dividen schema: 65% dari Bagi Hasil pool dibagi proporsional ke
 * pengelola by modal disetor.
 */
export const pengelola = pgTable(
  "pengelola",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    // Identity (lebih sederhana dibanding investor karena cuma 5 orang
    // yang udah dikenal owner — no KTP unique needed)
    fullName: text("full_name").notNull(),
    nickname: text("nickname"),
    nik: text("nik"),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    dateOfBirth: date("date_of_birth"),

    // Bank info
    bankName: text("bank_name"),
    bankAccountNumber: text("bank_account_number"),
    bankAccountHolderName: text("bank_account_holder_name"),

    /** Modal disetor (Rupiah). Truth source untuk %-share dividen
     *  dalam pengelola pool. */
    modalDisetor: bigint("modal_disetor", { mode: "number" })
      .notNull()
      .default(0),

    /* Sesi AE-80 — Saldo dividen pengelola yang belum dicairkan (mirror
     * pattern investors.dividend_balance). Pengelola pool dialokasikan
     * ke akun ini saat distribusi posted, decrement saat withdrawal. */
    dividendBalance: bigint("dividend_balance", { mode: "number" })
      .notNull()
      .default(0),

    /** Sesi AE-63a — opsional link ke users.id kalau pengelola juga
     *  jadi POS staff login (most are). Bukan FK ke employees karena
     *  per owner directive pengelola = entity terpisah. */
    userId: uuid("user_id").references(() => users.id),

    // Status
    status: text("status", {
      enum: ["active", "inactive", "exited"],
    })
      .notNull()
      .default("active"),
    exitedAt: timestamp("exited_at", { withTimezone: true }),
    exitReason: text("exit_reason"),

    notes: text("notes"),

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
    index("idx_pengelola_outlet_status").on(t.outletId, t.status),
    /* fullName unique per outlet — cuma 5 orang, hindari duplikasi
     *  Anisa Amalia vs anisa amalia case-mismatch. */
    uniqueIndex("ux_pengelola_outlet_name")
      .on(t.outletId, t.fullName)
      .where(sql`${t.deletedAt} IS NULL`),
    check("ck_pengelola_modal_nonneg", sql`${t.modalDisetor} >= 0`),
    /* Sesi AE-80 — dividen balance invariant (cannot go negative). */
    check(
      "ck_pengelola_dividend_balance_nonneg",
      sql`${t.dividendBalance} >= 0`,
    ),
  ],
);
