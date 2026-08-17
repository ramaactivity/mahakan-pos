import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { outlets } from "@/db/schema";
import { CUTOFF_OFF, parseBooksCutoff, type BooksCutoff } from "./cutoff-pure";

/**
 * Sesi AE-207 — BATAS BUKU (cutoff) "mulai bersih dari periode baru".
 *
 * Arahan owner: data operasional lama (pembelian bahan, pengeluaran kas,
 * opname periode lama, PR, pergerakan stok) dan seluruh jurnal sebelum tanggal
 * batas **DISEMBUNYIKAN, BUKAN DIHAPUS**. Layar bersih mulai periode baru,
 * tapi tidak ada satu baris pun yang hilang dari database — kalau suatu saat
 * perlu (audit, pajak, cek nota lama), owner tinggal mematikan setelannya di
 * Pengaturan → Batas Buku dan semua muncul lagi.
 *
 * Kenapa disembunyikan di lapisan QUERY, bukan lewat kolom `deleted_at`:
 *   1. Nol risiko — tidak ada UPDATE/DELETE ke data produksi.
 *   2. Satu sakelar, reversibel penuh, tanpa migration.
 *   3. Tidak bisa "kelupaan satu tabel" — floor dipasang DI DALAM fungsi
 *      query, jadi semua caller (halaman, laporan, ekspor) otomatis ikut.
 *
 * ⚠️ ATURAN: floor HANYA untuk jalur BACA daftar/laporan. JANGAN pasang di
 * jalur integritas — ambil-per-id, guard anti dobel-tarik PR, lock FOR UPDATE,
 * hook jurnal, sapuan jurnal. Kalau guard ikut ke-floor, data lama jadi "tak
 * terlihat" oleh pengaman → bisa dobel-post / dobel-tarik.
 *
 * ⚠️ PENGECUALIAN yang SENGAJA tidak di-floor (jangan "dirapikan"):
 *   - `fetchTopOutstanding` & nota `pending_payment` di `fetchTopHistory` —
 *     hutang yang masih hidup tidak boleh disembunyikan hanya karena tua.
 *   - Laporan PENJUALAN & menu — arahan owner: penjualan dipertahankan.
 *   - Rantai opname untuk HPP (`fetchLatestOpnameBefore` dkk) — butuh sesi
 *     stok-awal yang tanggalnya sebelum batas utama.
 *
 * Bentuk setelan di `outlets.settings.booksCutoff`:
 *   { date: "2026-07-01", opnameDate: "2026-06-01", note, setAt }
 *
 * Kenapa opname punya tanggal SENDIRI: sesi opname yang dihitung 30 Juni itu
 * justru STOK AWAL Juli. Kalau ikut di-floor 1 Juli, sesi itu ikut hilang dan
 * laporan pemakaian bahan Juli langsung rusak (stok awal 0 → "pemakaian" =
 * seluruh pembelian; persis bug AE-202/AE-201).
 */
export type { BooksCutoff };
export {
  CUTOFF_OFF,
  clampFromDate,
  cutoffStartInstant,
  isPeriodAtOrAfterCutoff,
} from "./cutoff-pure";

/** Baca setelan batas buku milik outlet. Tidak pernah throw. */
export async function getBooksCutoff(outletId: string): Promise<BooksCutoff> {
  const [row] = await db
    .select({ settings: outlets.settings })
    .from(outlets)
    .where(eq(outlets.id, outletId))
    .limit(1);
  if (!row) return CUTOFF_OFF;
  return parseBooksCutoff(
    (row.settings as { booksCutoff?: unknown } | null)?.booksCutoff,
  );
}

/** Batas utama saja — pemakaian tersering. */
export async function getCutoffDate(outletId: string): Promise<string | null> {
  return (await getBooksCutoff(outletId)).date;
}

/** Batas opname (jatuh kembali ke batas utama kalau tak di-set khusus). */
export async function getOpnameCutoffDate(
  outletId: string,
): Promise<string | null> {
  return (await getBooksCutoff(outletId)).opnameDate;
}
