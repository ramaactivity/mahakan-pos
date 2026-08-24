/**
 * Helper tanggal kalender WIB (Asia/Jakarta, UTC+7, tanpa DST).
 *
 * JANGAN pakai `new Date().toISOString().slice(0, 10)` untuk tanggal bisnis /
 * entryDate jurnal: itu tanggal UTC. Antara 00:00–06:59 WIB, UTC masih hari
 * kemarin — jurnal mendarat di hari (bahkan bulan, tiap tanggal 1) yang salah.
 *
 * JANGAN pula pakai `new Date(y, m, d).toISOString().slice(0, 10)` untuk batas
 * rentang: `new Date(y, m, d)` itu tengah malam WAKTU LOKAL, yang di WIB sama
 * dengan pukul 17:00 UTC HARI SEBELUMNYA — jadi batas rentangnya meleset satu
 * hari. Pakai `monthStartJakarta` / `addDaysJakarta` di bawah.
 *
 * Teknik sama dengan helper privat di accounting/auto-retry.ts & hooks.ts.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD menurut kalender WIB untuk instant `d`. */
export function jakartaDateOf(d: Date): string {
  const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

/** YYYY-MM-DD "hari ini" menurut kalender WIB. */
export function todayJakarta(): string {
  return jakartaDateOf(new Date());
}

/**
 * Menit sejak 00:00 WIB untuk instant `d` (0..1439).
 *
 * Sengaja TIDAK memakai `getHours()` dari Date yang sudah digeser: itu membaca
 * zona waktu mesin, yang di Vercel = UTC. Teknik sama dengan jakartaDateOf.
 */
export function jakartaMinutesOf(d: Date): number {
  const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return wib.getUTCHours() * 60 + wib.getUTCMinutes();
}

/**
 * Geser tanggal kalender YYYY-MM-DD sebanyak `days` hari (boleh negatif).
 *
 * Dihitung lewat UTC murni supaya zona waktu mesin (peramban staff, runner CI,
 * server Vercel yang UTC) tidak ikut mempengaruhi hasil.
 */
export function addDaysJakarta(iso: string, days: number): string {
  const base = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return iso;
  return new Date(base.getTime() + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Tanggal 1 dari bulan yang memuat `iso` (default: bulan berjalan WIB). */
export function monthStartJakarta(iso: string = todayJakarta()): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Tanggal terakhir dari bulan yang memuat `iso` (default: bulan berjalan WIB). */
export function monthEndJakarta(iso: string = todayJakarta()): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7)); // 1-12
  // Hari ke-0 bulan berikutnya = hari terakhir bulan ini (UTC, bebas zona lokal).
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
