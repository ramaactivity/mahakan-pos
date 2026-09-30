import { and, eq, gte, isNull, lt, lte, or, sql } from "drizzle-orm";
import { toJakartaDateOnly } from "@/lib/date";
import { expenses, incomes } from "@/db/schema";

/**
 * Sesi AE-227 — SATU tempat menjawab: "baris kas ini keluar/masuk laci kasir
 * atau tidak?"
 *
 * Arahan owner: "Apabila ada data pengeluaran apapun, jangan integrasi dengan
 * laporan kasir kedepannya. Soalnya data input manual dari dashboard langsung
 * mengurangi pada POS kasir, jadi laporan dari kasir jangan diganggu sama
 * dashboard perhitungannya."
 *
 * Sebelum ini setiap pengeluaran tunai hari itu memotong Kas Harusnya kasir,
 * tak peduli diinputnya dari mana. Owner mencatat pengeluaran dari dashboard →
 * angka setoran kasir langsung berkurang → kasir kelihatan kelebihan uang di
 * laci padahal tidak melakukan apa-apa.
 *
 * ATURAN: setiap query yang menghitung ISI LACI KASIR wajib memakai filter di
 * file ini — bukan menulis `eq(expenses.entryOrigin, "pos")` sendiri. Baris
 * lama (`entry_origin IS NULL`, sebelum sesi AE-227) dihitung sebagai 'pos'
 * supaya shift yang sudah tertutup tidak berubah surut; kalau tiap pemanggil
 * menulis filternya sendiri, satu saja yang lupa menangani NULL akan
 * menghapus seluruh riwayat petty cash dari laporan.
 *
 * Yang MEMAKAI filter ini (semuanya angka yang dilihat kasir):
 *   - tutup shift → Kas Harusnya & variance      (`shifts/actions.ts`)
 *   - rincian petty cash per shift               (`shifts/queries.ts`)
 *   - rebalance kas shift                        (`shifts/rebalance-actions.ts`)
 *   - Kas Tersedia / setoran                     (`finance/queries.ts`)
 *
 * Yang TIDAK memakai filter ini — sengaja, jangan "dirapikan":
 *   - Laporan keuangan, Laba Rugi, jurnal akuntansi. Pengeluaran dari
 *     dashboard tetap beban perusahaan yang sah; yang berubah hanya siapa yang
 *     dianggap memegang uangnya.
 *   - Daftar/riwayat pengeluaran di halaman Kas back office — owner tetap
 *     harus melihat semuanya di sana.
 */

/** Nilai kolom `entry_origin`. Lihat komentar skema di `db/schema/expenses.ts`. */
export type CashEntryOrigin = "pos" | "backoffice";

/**
 * Baris kas yang dibuat DI LUAR kasir (dashboard: Kas back office, Pembelian,
 * Payroll, Hutang Internal). Dipakai saat insert supaya tidak ada yang
 * mengandalkan default DB — kolomnya sengaja tanpa default.
 */
export const BACKOFFICE_ORIGIN = "backoffice" as const;

/** Baris kas yang benar-benar lewat laci kasir (Petty Cash POS, refund POS). */
export const POS_ORIGIN = "pos" as const;

/**
 * Pengeluaran yang mengurangi isi laci kasir.
 * NULL = baris sebelum AE-227 → tetap dihitung (lihat alasan di atas).
 */
export function expenseAffectsDrawer() {
  return sql`(${expenses.entryOrigin} IS NULL OR ${expenses.entryOrigin} = 'pos')`;
}

/** Pemasukan yang menambah isi laci kasir. Pasangan `expenseAffectsDrawer`. */
export function incomeAffectsDrawer() {
  return sql`(${incomes.entryOrigin} IS NULL OR ${incomes.entryOrigin} = 'pos')`;
}

/**
 * Versi in-memory dari filter di atas, untuk baris yang sudah terlanjur
 * di-fetch (mis. `fetchDailyCashSummary` yang memecah satu hasil query jadi
 * beberapa ember sekaligus). Aturannya WAJIB sama: NULL = baris lama = laci.
 */
export function affectsDrawer(
  entryOrigin: CashEntryOrigin | string | null | undefined,
): boolean {
  return entryOrigin == null || entryOrigin === POS_ORIGIN;
}

/**
 * Sesi AE-236 — SATU definisi "petty cash laci milik shift ini".
 *
 * Dulu tutup shift, rincian shift, dan rebalance masing-masing menulis
 * rentangnya sendiri: tanggal WIB buka s/d tanggal WIB tutup, utuh. Shift
 * yang ditutup lewat tengah malam (mis. 20 Jul 00:00) jadi ikut menyedot
 * SELURUH hari tanggal 20 — pengeluaran shift berikutnya ikut tampil di
 * shift tanggal 19. Sekarang baris bertanggal hari tutup hanya ikut kalau
 * diinput sebelum shift ditutup; baris ber-tanggal-mundur di hari-hari
 * sebelumnya tetap ikut seperti dulu.
 */
type ShiftWindow = { outletId: string; openedAt: Date; closedAt: Date | null };

function shiftDateRange(shift: ShiftWindow) {
  return {
    from: toJakartaDateOnly(shift.openedAt),
    to: toJakartaDateOnly(shift.closedAt ?? new Date()),
  };
}

export function expenseInShiftDrawer(shift: ShiftWindow) {
  const { from, to } = shiftDateRange(shift);
  return and(
    eq(expenses.outletId, shift.outletId),
    eq(expenses.paymentMethod, "cash"),
    expenseAffectsDrawer(),
    gte(expenses.expenseDate, from),
    lte(expenses.expenseDate, to),
    shift.closedAt
      ? or(lt(expenses.expenseDate, to), lte(expenses.createdAt, shift.closedAt))
      : undefined,
    isNull(expenses.deletedAt),
  );
}

export function incomeInShiftDrawer(shift: ShiftWindow) {
  const { from, to } = shiftDateRange(shift);
  return and(
    eq(incomes.outletId, shift.outletId),
    eq(incomes.paymentMethod, "cash"),
    incomeAffectsDrawer(),
    gte(incomes.incomeDate, from),
    lte(incomes.incomeDate, to),
    shift.closedAt
      ? or(lt(incomes.incomeDate, to), lte(incomes.createdAt, shift.closedAt))
      : undefined,
    isNull(incomes.deletedAt),
  );
}
