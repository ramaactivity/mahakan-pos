/**
 * Sesi AE-222 — PEMILIH BULAN DASHBOARD.
 *
 * Dashboard dulu terkunci di bulan berjalan: begitu tanggal berganti bulan,
 * angka bulan sebelumnya hilang dari layar dan owner harus masuk ke modul
 * Laporan/Akuntansi satu per satu untuk melihatnya kembali.
 *
 * Semua hitungan di sini memakai kalender WIB dan hanya mengolah string
 * "YYYY-MM" / "YYYY-MM-DD" — tidak menyentuh zona waktu mesin, supaya hasil
 * di laptop owner dan di server Vercel (yang UTC) selalu sama.
 */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Bulan berjalan menurut kalender WIB, "YYYY-MM". */
export function currentMonthWib(now: Date = new Date()): string {
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 7);
}

export function isValidMonth(month: string): boolean {
  return MONTH_RE.test(month);
}

/** Geser bulan sebanyak `delta` (boleh negatif). */
export function shiftMonth(month: string, delta: number): string {
  if (!isValidMonth(month)) return month;
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  /* Lewat Date.UTC supaya pergantian tahun ikut benar tanpa cabang sendiri. */
  const d = new Date(Date.UTC(year, mon - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export interface MonthRange {
  /** Tanggal pertama bulan itu, "YYYY-MM-DD". */
  fromDate: string;
  /** Tanggal TERAKHIR bulan itu — untuk bulan berjalan tetap akhir bulan,
   * konsisten dengan perilaku Neraca sebelumnya. */
  toDate: string;
  /** "September 2026" */
  label: string;
}

const BULAN = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

export function monthRange(month: string): MonthRange {
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  /* Hari ke-0 bulan berikutnya = hari terakhir bulan ini. Dihitung di UTC
   * murni supaya Februari kabisat ikut benar tanpa tabel hari. */
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return {
    fromDate: `${month}-01`,
    toDate: `${month}-${String(lastDay).padStart(2, "0")}`,
    label: `${BULAN[mon - 1]} ${year}`,
  };
}

/** Bulan di depan tidak boleh dipilih — tidak ada datanya. */
export function isFutureMonth(month: string, current: string): boolean {
  return month > current;
}
