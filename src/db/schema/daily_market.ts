import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  bigint,
  numeric,
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

/**
 * Sesi AE-245 — BARIS BAHAN per belanja pasar.
 *
 * MEMBALIK keputusan AE-243 ("sengaja tanpa qty/harga/stok") atas permintaan
 * owner: belanja pasar kini mencatat qty + harga per bahan dan menggerakkan
 * stok, sama seperti Purchasing. Purchasing TETAP ADA dan tidak berubah —
 * jalurnya yang beda, bukan penggantinya:
 *
 *   Purchasing   : ada supplier, ada nota, ada hutang/TOP → PR→PO→GR
 *   Daily Market : pasar harian, bayar tunai dari saldo kurir, tanpa supplier
 *
 * Dobel hitung dicegah oleh AKUNnya, bukan oleh larangan. Rupiah yang punya
 * baris bahan dibukukan sebagai PERSEDIAAN (1140/1141/1142) persis seperti
 * Purchasing, bukan sebagai beban. Sisanya — parkir, plastik, kuli angkut —
 * barulah masuk akun beban kategori. Jadi satu nota tidak pernah muncul dua
 * kali: tiap rupiah hanya punya satu akun.
 *
 * Stoknya memakai gerbang yang SAMA dengan Purchasing (`getStockMode`
 * .addOnPurchase + rem backdate-opname). Di mode periodic — mode yang sedang
 * dipakai outlet ini — keduanya sama-sama tidak menambah stok, dan movement
 * tetap ditulis dengan `skippedStockUpdate=true` supaya jejaknya utuh.
 */
export const dailyMarketItems = pgTable(
  "daily_market_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => dailyMarketEntries.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id").notNull(),

    /** Qty apa adanya seperti yang diketik (satuan belanja), utk audit nota. */
    qty: numeric("qty", { precision: 14, scale: 4 }).notNull(),
    /** Satuan belanja; NULL = memang satuan dasar bahannya. */
    unit: text("unit"),
    /** Hasil konversi ke satuan dasar — sumber kebenaran pergerakan stok. */
    qtyMaster: numeric("qty_master", { precision: 14, scale: 4 }).notNull(),

    /** Rp per satuan belanja (bulat). */
    unitCost: bigint("unit_cost", { mode: "number" }).notNull(),
    /**
     * Rupiah baris ini. Sesi AE-216 berlaku di sini juga: TOTAL yang menang,
     * bukan `qty × unitCost` — harga satuan wajib bulat, jadi perkaliannya
     * membuang sisa pembulatan dan nota Rp 227.000 tercatat Rp 226.880.
     */
    subtotal: bigint("subtotal", { mode: "number" }).notNull(),

    /* Jepretan saat dibeli — bahan boleh berganti nama/seksi nanti, laporan
     * lama harus tetap membaca apa yang berlaku waktu itu. */
    nameSnapshot: text("name_snapshot").notNull(),
    unitSnapshot: text("unit_snapshot").notNull(),
    sectionSnapshot: text("section_snapshot"),

    /** Movement stok yang dibuat baris ini (NULL = belum pernah dibuat). */
    movementId: uuid("movement_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_daily_market_items_entry").on(t.entryId),
    index("idx_daily_market_items_ingredient").on(t.ingredientId),
    check("ck_daily_market_items_qty_pos", sql`${t.qty} > 0`),
    check("ck_daily_market_items_qty_master_pos", sql`${t.qtyMaster} > 0`),
    check("ck_daily_market_items_subtotal_pos", sql`${t.subtotal} > 0`),
    check("ck_daily_market_items_unit_cost_nonneg", sql`${t.unitCost} >= 0`),
  ],
);
