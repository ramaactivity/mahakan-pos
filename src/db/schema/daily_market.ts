import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  bigint,
  index,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";
import { bankAccounts } from "./bank-accounts";
import { expenseCategories } from "./expenses";

/**
 * Sesi AE-242 — BELANJA DAILY MARKET.
 *
 * Alurnya di lapangan: kami transfer sejumlah uang ke kurir (top up), kurir
 * belanja ke pasar beberapa kali, sisa saldonya dipakai hari berikutnya.
 *
 * Saldo kurir TIDAK dihitung oleh tabel ini. Saldonya adalah saldo akun
 * **1103 Saldo Kurir Daily Market** di buku besar, karena kodenya masuk pola
 * kas & bank (`^11[01][0-9]$`) — jadi Buku Kas, Neraca, dan Arus Kas langsung
 * membacanya tanpa mesin saldo kedua yang harus dijaga agar tidak melenceng.
 *
 *   Top up  : Dr 1103 / Cr <rekening bank asal>   → saldo BCA ikut berkurang
 *   Belanja : Dr <akun beban kategori> / Cr 1103  → saldo kurir ikut berkurang
 *
 * Tabel ini hanya catatan operasional + penghubung ke jurnalnya.
 */
export const dailyMarketEntries = pgTable(
  "daily_market_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    kind: text("kind", { enum: ["topup", "spend"] }).notNull(),

    /** Tanggal buku (WIB) — dipakai sebagai entry_date jurnal. */
    entryDate: date("entry_date").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    amount: bigint("amount", { mode: "number" }).notNull(),
    description: text("description").notNull(),

    /** Nama kurir/driver. Sengaja teks, bukan tabel master: saldo dikelola
     * satu kantong (akun 1103), bukan per orang.
     * ponytail: kalau nanti perlu saldo PER kurir, barulah bikin masternya
     * dan pecah 1103 jadi sub-akun per kurir. */
    courierName: text("courier_name"),

    /** Rekening asal transfer — hanya untuk kind='topup'. */
    bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),
    /** Kategori biaya — hanya untuk kind='spend', menentukan akun bebannya. */
    categoryId: uuid("category_id").references(() => expenseCategories.id),

    receiptImageUrl: text("receipt_image_url"),

    status: text("status", { enum: ["posted", "reversed"] })
      .notNull()
      .default("posted"),
    journalEntryId: uuid("journal_entry_id"),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by").references(() => users.id),
    reversalReason: text("reversal_reason"),

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
  },
  (t) => [
    index("idx_daily_market_outlet_date").on(t.outletId, t.entryDate),
    index("idx_daily_market_outlet_kind").on(t.outletId, t.kind),
    check("ck_daily_market_amount_pos", sql`${t.amount} > 0`),
    /* Top up wajib punya rekening asal (uangnya keluar dari sana); belanja
     * wajib punya kategori (penentu akun bebannya). Ditegakkan di DB supaya
     * jalur mana pun tidak bisa menyimpan baris yang jurnalnya mustahil. */
    check(
      "ck_daily_market_shape",
      sql`(${t.kind} = 'topup' AND ${t.bankAccountId} IS NOT NULL)
        OR (${t.kind} = 'spend' AND ${t.categoryId} IS NOT NULL)`,
    ),
  ],
);
