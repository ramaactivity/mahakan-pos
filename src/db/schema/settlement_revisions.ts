import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  bigint,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";
import { aggregatorSettlements } from "./aggregator_settlements";

/**
 * Sesi AE-246 — REVISI SETTLEMENT per hari.
 *
 * Angka settlement yang dihitung sistem dari transaksi POS tidak selalu sama
 * dengan uang yang benar-benar masuk ke rekening, dan rekening penerimanya
 * bisa berbeda-beda dalam satu bulan (ada yang ke Mandiri, ada yang ke BNI).
 *
 * Tabel ini TIDAK mengubah baris settlement-nya maupun jurnal aslinya — sama
 * seperti Pindah Rekening (AE-219). Yang disimpan di sini adalah "apa yang
 * sebenarnya terjadi" beserta jurnal penyeimbangnya, supaya penelusur nanti
 * melihat dua-duanya: yang tercatat semula dan koreksinya. Mengubah jurnal
 * lama akan menghapus jejak bahwa sistem pernah salah hitung, dan justru itu
 * yang perlu terbaca saat rekening koran dicocokkan.
 *
 * `recordedAmount` + `recordedAccountCode` adalah JEPRETAN dari jurnal asli
 * saat revisi dibuat, bukan hasil hitung ulang. Pengaturan rekening per
 * channel bisa berubah kapan saja; kalau nilainya diturunkan ulang nanti,
 * pembalikan revisi ini bisa memakai angka yang berbeda dari yang dipakai
 * waktu memposting, dan selisihnya menetap diam-diam.
 */
export const settlementRevisions = pgTable(
  "settlement_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    settlementId: uuid("settlement_id")
      .notNull()
      .references(() => aggregatorSettlements.id),

    /** Tanggal buku jurnal revisi (WIB) — ikut tanggal settlement-nya. */
    entryDate: date("entry_date").notNull(),

    /** Jepretan: nilai & rekening yang terlanjur tercatat di jurnal asli. */
    recordedAmount: bigint("recorded_amount", { mode: "number" }).notNull(),
    recordedAccountCode: text("recorded_account_code").notNull(),

    /** Kenyataan menurut rekening koran. */
    actualAmount: bigint("actual_amount", { mode: "number" }).notNull(),
    actualAccountCode: text("actual_account_code").notNull(),

    /** actualAmount − recordedAmount. Negatif = uang masuk lebih kecil. */
    diffAmount: bigint("diff_amount", { mode: "number" }).notNull(),

    reason: text("reason").notNull(),

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
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    index("idx_settlement_revisions_settlement").on(t.settlementId),
    index("idx_settlement_revisions_outlet_date").on(t.outletId, t.entryDate),
    check("ck_settlement_revisions_recorded_pos", sql`${t.recordedAmount} > 0`),
    check("ck_settlement_revisions_actual_nonneg", sql`${t.actualAmount} >= 0`),
    /* Satu settlement hanya boleh punya SATU revisi berlaku. Revisi kedua di
     * atas revisi pertama akan mengeluarkan nilai tercatat yang sama dua kali
     * dari rekening lama — saldonya minus tanpa jurnal yang timpang. Mau
     * memperbaiki lagi? Batalkan dulu yang lama. */
    uniqueIndex("ux_settlement_revisions_one_active")
      .on(t.settlementId)
      .where(sql`${t.status} = 'posted'`),
  ],
);
