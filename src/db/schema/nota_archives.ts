import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  numeric,
  integer,
  bigint,
  index,
  check,
} from "drizzle-orm/pg-core";
import { outlets } from "./outlets";
import { users } from "./users";

/**
 * Sesi AE-132 — Arsip Nota (Receipt Archive).
 *
 * Modul dokumentasi murni untuk staff: foto nota Cash + TOP supplier +
 * operasional (listrik/air/internet/sewa) + maintenance + marketing
 * dll. TIDAK terkoneksi ke modul keuangan/jurnal — purely archival
 * supaya nota fisik tidak hilang dan owner/manager bisa cek dari jauh.
 *
 * Flow:
 *   1. Staff upload via `/m/nota` (1 nota = 1 row archive + N file rows).
 *   2. File asli di-upload ke Google Drive (folder ARSIP NOTA/{YYYY}/
 *      {NN. MONTH}/{KATEGORI}). Drive URL + fileId disimpan di file row.
 *   3. Owner/Manager review di back office — mark sebagai "reviewed"
 *      dengan optional komentar.
 *   4. Audit log: upload + review + archive.
 *
 * Why 1-to-many file rows: 1 nota bisa punya >1 foto (struk panjang
 * difoto multi-frame, depan-belakang, atau set multi-nota dalam 1
 * transaksi). Caller di-batas max 10 file per nota di action layer.
 */

export const notaArchiveCategoryValues = [
  "pembelian_cash",
  "pembayaran_top",
  "operasional",
  "maintenance",
  "marketing",
  "pajak_admin",
  "gaji_thr",
  "aset",
  "lainnya",
] as const;

export type NotaArchiveCategory = (typeof notaArchiveCategoryValues)[number];

export const notaArchiveStatusValues = [
  "pending_review",
  "reviewed",
  "flagged",
] as const;
export type NotaArchiveStatus = (typeof notaArchiveStatusValues)[number];

export const notaArchives = pgTable(
  "nota_archives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    /** Tanggal nota fisik (drives Drive year/month folder). */
    notaDate: date("nota_date").notNull(),
    category: text("category", { enum: notaArchiveCategoryValues }).notNull(),
    /** Keterangan singkat — "Belanja kopi Pak Slamet", "Bayar listrik PLN". */
    description: text("description").notNull(),
    /** Nominal nota — opsional (kadang staff belum tau total final). */
    amount: numeric("amount", { precision: 15, scale: 2 }),

    status: text("status", { enum: notaArchiveStatusValues })
      .notNull()
      .default("pending_review"),

    /** Catatan reviewer (Owner/Manager) saat mark reviewed/flagged. */
    reviewerNote: text("reviewer_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => users.id),

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
    index("idx_nota_archives_outlet_date").on(t.outletId, t.notaDate),
    index("idx_nota_archives_outlet_status").on(t.outletId, t.status),
    index("idx_nota_archives_outlet_category").on(t.outletId, t.category),
    check(
      "ck_nota_archives_desc_nonempty",
      sql`length(trim(${t.description})) > 0`,
    ),
    check(
      "ck_nota_archives_amount_pos",
      sql`${t.amount} IS NULL OR ${t.amount} >= 0`,
    ),
  ],
);

export const notaArchiveFiles = pgTable(
  "nota_archive_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notaArchiveId: uuid("nota_archive_id")
      .notNull()
      .references(() => notaArchives.id, { onDelete: "cascade" }),
    /** Drive webViewLink (anyone-with-link reader). */
    fileUrl: text("file_url").notNull(),
    /** Drive file ID — untuk delete/rename via API. */
    driveFileId: text("drive_file_id").notNull(),
    /** Drive parent folder ID — caching supaya buka folder cepat. */
    driveFolderId: text("drive_folder_id"),
    originalName: text("original_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    /** Urutan tampil di galeri (kalau staff upload multi-frame). */
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_nota_archive_files_archive").on(t.notaArchiveId)],
);

export type NotaArchive = typeof notaArchives.$inferSelect;
export type NotaArchiveFile = typeof notaArchiveFiles.$inferSelect;
