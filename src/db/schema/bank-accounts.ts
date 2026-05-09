import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";

/**
 * Sesi AE-13 — Bank accounts master untuk dropdown selector.
 *
 * Sebelumnya bank destination diketik free-text di setiap setoran (mis.
 * "BCA — Owner 1234567890"). Sering typo + ga konsisten + reporting susah.
 * Tabel ini jadi master rekening yang owner register sekali di Settings,
 * lalu dropdown di setiap modul (Catat Setoran, Setor ke Owner di Tutup
 * Shift, future expense modules).
 *
 * Kolom display untuk dropdown:
 *   "{bankName} — {accountName} {accountNumberShort}"
 *   contoh: "BCA — Owner Galih ...7890"
 *
 * Soft-delete pattern (deletedAt) supaya historical setoran yang reference
 * akun ini tetap valid; dropdown filter isActive=true.
 */
export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    /** Bank name — "BCA", "BRI", "Mandiri", "Tunai (kas owner)", dll. */
    bankName: text("bank_name").notNull(),
    /** Pemilik rekening — "Galih Rama Pratama", "Mahakan Coffee", dll. */
    accountName: text("account_name").notNull(),
    /** Nomor rekening (free-text, support international format).
     * Untuk "Tunai (kas owner)" boleh kosong string. */
    accountNumber: text("account_number").notNull().default(""),

    /** Apakah masih aktif untuk pilih di dropdown. False = soft-deleted
     * tapi historical setoran tetap valid reference. */
    isActive: boolean("is_active").notNull().default(true),
    /** Display order di dropdown. Smaller = atas. */
    displayOrder: integer("display_order").notNull().default(0),
    /** Optional notes untuk owner ("BCA Owner pribadi", "BRI shop"). */
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
    // Unique aktif per outlet + bank+nama+nomor — prevent duplicate.
    uniqueIndex("ux_bank_accounts_outlet_uniq")
      .on(t.outletId, t.bankName, t.accountName, t.accountNumber)
      .where(sql`${t.deletedAt} IS NULL`),
    index("idx_bank_accounts_outlet_active").on(t.outletId, t.isActive),
    check(
      "ck_bank_accounts_bank_name_nonempty",
      sql`length(trim(${t.bankName})) > 0`,
    ),
    check(
      "ck_bank_accounts_account_name_nonempty",
      sql`length(trim(${t.accountName})) > 0`,
    ),
  ],
);
