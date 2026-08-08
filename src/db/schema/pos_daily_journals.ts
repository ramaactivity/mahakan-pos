import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  integer,
  date,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";

/**
 * Sesi AE-193 — batch jurnal penjualan HARIAN.
 *
 * Sebelumnya tiap transaksi POS menghasilkan satu journal entry (~5,5 baris).
 * Per Agustus 2026 itu 1.619 dari 2.244 entry (72%) dan 8.901 dari 10.358
 * baris (86%) di seluruh buku besar — beban tulis di jalur pembayaran POS dan
 * tabel yang tumbuh paling cepat. Owner minta jurnal dibuat per akhir
 * shift/hari saja.
 *
 * Satu baris di sini = satu hari kalender WIB untuk satu outlet, dan menjadi
 * `sourceId` bagi journal entry `pos_daily_sales` / `pos_daily_compliment`.
 * Punya tabel sendiri (bukan sekadar UUID turunan tanggal) supaya:
 *  - ada snapshot APA yang diringkas (jumlah transaksi + total) untuk audit;
 *  - `ux_je_outlet_source_active` yang sudah ada otomatis menjamin satu entry
 *    aktif per hari — idempoten tanpa kode tambahan;
 *  - hitung ulang (void/koreksi menyusul) punya tempat mencatat sudah berapa
 *    kali dan kapan terakhir.
 *
 * KENAPA per hari kalender, BUKAN per shift: 26 dari 82 shift buka sebelum
 * dan tutup sesudah tengah malam (buka 10:00, tutup 01:30). Kalau diberi
 * tanggal tutup shift, 632 dari 1.752 transaksi mendarat di tanggal yang
 * salah dan sebagian lompat bulan → laporan harian & tutup buku bulanan
 * ikut salah. Shift yang melewati tengah malam menghasilkan DUA batch.
 */
export const posDailyJournals = pgTable(
  "pos_daily_journals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),

    /** Tanggal kalender WIB yang diringkas (YYYY-MM-DD). */
    entryDate: date("entry_date").notNull(),

    /** 'sales' = penjualan biasa, 'compliment' = transaksi gratisan (HPP saja). */
    kind: text("kind", { enum: ["sales", "compliment"] }).notNull(),

    /**
     * 'posted'  = jurnalnya sudah tercatat & masih mencerminkan data terkini
     * 'stale'   = ada transaksi hari itu yang berubah (void/koreksi) setelah
     *             jurnal dibuat → wajib dihitung ulang oleh sapuan
     * 'skipped' = tidak ada apa pun untuk dijurnal hari itu (nol transaksi)
     */
    status: text("status", { enum: ["posted", "stale", "skipped"] })
      .notNull()
      .default("posted"),

    /** Snapshot ringkasan — untuk audit & deteksi drift tanpa hitung ulang. */
    transactionCount: integer("transaction_count").notNull().default(0),
    grossTotal: bigint("gross_total", { mode: "number" }).notNull().default(0),
    discountTotal: bigint("discount_total", { mode: "number" })
      .notNull()
      .default(0),
    cogsTotal: bigint("cogs_total", { mode: "number" }).notNull().default(0),

    /** Berapa kali batch ini dihitung ulang (naik saat void/koreksi menyusul). */
    recomputeCount: integer("recompute_count").notNull().default(0),

    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_pos_daily_journals_outlet_date_kind").on(
      t.outletId,
      t.entryDate,
      t.kind,
    ),
    index("idx_pos_daily_journals_status").on(t.status, t.entryDate),
    check(
      "ck_pos_daily_journals_nonneg",
      sql`${t.transactionCount} >= 0 AND ${t.grossTotal} >= 0 AND ${t.discountTotal} >= 0 AND ${t.cogsTotal} >= 0`,
    ),
  ],
);
