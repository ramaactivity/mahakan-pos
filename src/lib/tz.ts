/**
 * Helper tanggal kalender WIB (Asia/Jakarta, UTC+7, tanpa DST).
 *
 * JANGAN pakai `new Date().toISOString().slice(0, 10)` untuk tanggal bisnis /
 * entryDate jurnal: itu tanggal UTC. Antara 00:00–06:59 WIB, UTC masih hari
 * kemarin — jurnal mendarat di hari (bahkan bulan, tiap tanggal 1) yang salah.
 *
 * Teknik sama dengan helper privat di accounting/auto-retry.ts & hooks.ts.
 */

/** YYYY-MM-DD menurut kalender WIB untuk instant `d`. */
export function jakartaDateOf(d: Date): string {
  const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

/** YYYY-MM-DD "hari ini" menurut kalender WIB. */
export function todayJakarta(): string {
  return jakartaDateOf(new Date());
}
