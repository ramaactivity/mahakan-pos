/**
 * Sesi AE-207 — logika murni BATAS BUKU (tanpa DB, bisa dites).
 *
 * Lihat `cutoff.ts` untuk latar belakang lengkap: data sebelum batas buku
 * DISEMBUNYIKAN, bukan dihapus, dan opname punya batas sendiri karena sesi
 * akhir bulan sebelum cutoff adalah stok awal periode baru.
 */

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type BooksCutoff = {
  /** Batas utama (YYYY-MM-DD). null = cutoff tidak aktif. */
  date: string | null;
  /** Batas khusus opname (YYYY-MM-DD). Jatuh kembali ke `date`. */
  opnameDate: string | null;
  note: string | null;
  setAt: string | null;
};

export const CUTOFF_OFF: BooksCutoff = {
  date: null,
  opnameDate: null,
  note: null,
  setAt: null,
};

function asDate(v: unknown): string | null {
  return typeof v === "string" && DATE_RE.test(v) ? v : null;
}

/**
 * Normalisasi nilai mentah `outlets.settings.booksCutoff` jadi bentuk yang
 * pasti aman dipakai. Tanpa `date` yang valid, cutoff dianggap MATI — jadi
 * setelan setengah jadi / rusak tidak pernah menyembunyikan data diam-diam.
 */
export function parseBooksCutoff(raw: unknown): BooksCutoff {
  if (!raw || typeof raw !== "object") return CUTOFF_OFF;
  const o = raw as Record<string, unknown>;
  const date = asDate(o.date);
  if (!date) return CUTOFF_OFF;
  return {
    date,
    opnameDate: asDate(o.opnameDate) ?? date,
    note: typeof o.note === "string" ? o.note : null,
    setAt: typeof o.setAt === "string" ? o.setAt : null,
  };
}

/**
 * Naikkan batas bawah rentang tanggal ke `floor`.
 *
 * - `from=null` (laporan kumulatif, mis. Neraca) + floor → jadi `floor`.
 *   Ini inti "saldo bersih periode baru": Neraca berhenti menjumlah sejak awal
 *   waktu dan mulai dari jurnal Saldo Awal.
 * - `from` lebih tua dari floor → dinaikkan ke floor.
 * - `from` sudah di dalam periode aktif → dibiarkan apa adanya.
 */
export function clampFromDate(
  from: string | null | undefined,
  floor: string | null,
): string | null {
  if (!floor) return from ?? null;
  if (!from) return floor;
  return from < floor ? floor : from;
}

/**
 * Versi timestamp dari `clampFromDate`, untuk tabel yang menyaring pakai
 * `created_at` (mis. `inventory_movements`, `stock_opname_sessions`).
 *
 * ⚠️ JANGAN `new Date(floor)` — itu tengah malam UTC = 07:00 WIB, jadi mutasi
 * pukul 00:00–06:59 WIB di hari batas ikut ke-filter keluar (atau data 30 Juni
 * malam justru ikut masuk). Tengah malam WIB = 17:00 UTC hari sebelumnya.
 */
export function cutoffStartInstant(floor: string | null): Date | null {
  return floor ? new Date(`${floor}T00:00:00.000+07:00`) : null;
}

/**
 * Apakah bulan (year, month) berada pada/sesudah batas buku? Dipakai daftar
 * periode akuntansi supaya bulan yang jurnalnya disembunyikan tidak lagi
 * ditawarkan di pemilih periode (hasilnya pasti kosong → bikin bingung).
 */
export function isPeriodAtOrAfterCutoff(
  year: number,
  month: number,
  floor: string | null,
): boolean {
  if (!floor) return true;
  const fy = Number(floor.slice(0, 4));
  const fm = Number(floor.slice(5, 7));
  return year * 100 + month >= fy * 100 + fm;
}
