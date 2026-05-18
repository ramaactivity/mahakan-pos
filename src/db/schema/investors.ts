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
 * Sesi AE-63a — Investor master record.
 *
 * Mahakan Coffee dibiayai oleh 110+ investor publik (mayoritas mahasiswa /
 * karyawan swasta) yang patungan capital — total ~Rp 99,5 juta. Pre-system
 * data dikelola di Google Sheets (MAHAKAN BUSINESS DASHBOOARD - 2026).
 *
 * Berbeda dari `employees` (staff Mahakan yang digaji bulanan/harian),
 * investor adalah shareholder eksternal yang dapat dividen periodik
 * berdasarkan profit-share schema (lihat profit_distributions).
 *
 * Berbeda dari `pengelola` (5 manager Mahakan yang juga shareholder),
 * investor TIDAK ikut operasional sehari-hari — mereka cuma kontribusi
 * modal awal.
 *
 * `modalDisetor` = akumulasi semua setoran (initial + top-up) dikurangi
 * withdrawal yang sudah di-post. Truth source untuk %-share kalkulasi
 * dividen tetap di tabel ini (snapshot saat compute distribution).
 */
export const investors = pgTable(
  "investors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    // Identity
    fullName: text("full_name").notNull(),
    nickname: text("nickname"),
    /** KTP number, 16 digit. Optional tapi unique per outlet kalau di-set. */
    nik: text("nik"),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    dateOfBirth: date("date_of_birth"),
    /** "Pelajar / Mahasiswa", "Karyawan swasta", "Wiraswasta", dll. */
    occupation: text("occupation"),
    /** Instagram handle (mis. "@nadya..."). Mahakan ngirim notif via IG
     *  occasionally; field opsional tapi banyak diisi. */
    igHandle: text("ig_handle"),

    // Bank info untuk transfer dividen
    bankName: text("bank_name"),
    bankAccountNumber: text("bank_account_number"),
    /** Atas nama rekening (bisa beda dari fullName — banyak investor
     *  pakai rekening family member). */
    bankAccountHolderName: text("bank_account_holder_name"),

    /** Modal disetor (Rupiah). Snapshot truth untuk %-share dividen.
     *  Akumulasi dari semua capital_movements kind='initial_deposit' +
     *  'top_up' minus 'withdrawal'. Server denormalize untuk speed. */
    modalDisetor: bigint("modal_disetor", { mode: "number" })
      .notNull()
      .default(0),

    // Status lifecycle
    status: text("status", {
      enum: ["active", "inactive", "exited"],
    })
      .notNull()
      .default("active"),
    /** Tanggal exit kalau status='exited'. */
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
    index("idx_investors_outlet_status").on(t.outletId, t.status),
    /* Partial unique: NIK unique per outlet kalau di-set (banyak row NIK
     * null karena Sheets historikal nggak lengkap). */
    uniqueIndex("ux_investors_outlet_nik")
      .on(t.outletId, t.nik)
      .where(sql`${t.nik} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    /* Email unique kalau di-set (sebagian investor share email family). */
    uniqueIndex("ux_investors_outlet_email")
      .on(t.outletId, t.email)
      .where(sql`${t.email} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    check("ck_investors_modal_nonneg", sql`${t.modalDisetor} >= 0`),
    check(
      "ck_investors_exit_consistency",
      sql`(${t.status} = 'exited' AND ${t.exitedAt} IS NOT NULL)
        OR (${t.status} != 'exited')`,
    ),
  ],
);
