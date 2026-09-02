/**
 * Pure helpers for monthly opname cadence — Asia/Jakarta is the reference
 * timezone (Owner ops in WIB; bookkeeping monthly cycle aligns to local
 * calendar, not UTC).
 */

const JAKARTA_TZ = "Asia/Jakarta";

const MONTH_LABELS_ID = [
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

/** Returns YYYY-MM in Asia/Jakarta — used as a stable cadence key. */
export function jakartaMonthKey(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: JAKARTA_TZ,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  return `${y}-${m}`;
}

/** "April 2026" Indonesian label for the same instant. */
export function jakartaMonthLabel(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: JAKARTA_TZ,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value;
  const mStr = parts.find((p) => p.type === "month")?.value ?? "01";
  const m = parseInt(mStr, 10);
  return `${MONTH_LABELS_ID[m - 1]} ${y}`;
}

/** Returns the YYYY-MM key for the month containing `at`. */
export function jakartaMonthKeyOf(at: Date): string {
  return jakartaMonthKey(at);
}

/**
 * Sesi AE-230 — bulan yang PALING MUNGKIN diwakili sebuah opname yang dimulai
 * pada `now`.
 *
 * Hitungan fisik jarang selesai tepat di hari terakhir bulan; yang lazim
 * adalah menghitung di hari-hari pertama bulan berikutnya untuk menutup bulan
 * yang baru lewat. Kejadian nyata: stok akhir Agustus 2026 dihitung 1
 * September sore, lalu tercatat sebagai opname September — rekap COGS Agustus
 * jadi kosong sama sekali.
 *
 * Ini cuma NILAI AWAL di layar; owner tetap bisa memilih bulan lain.
 */
export function suggestedOpnamePeriodKey(now: Date): string {
  const key = jakartaMonthKey(now);
  const dayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: JAKARTA_TZ,
    day: "2-digit",
  }).format(now);
  const day = parseInt(dayStr, 10);
  if (day > OPNAME_PREV_MONTH_GRACE_DAYS) return key;
  const [y, m] = key.split("-").map(Number);
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
}

/** Hari pertama bulan yang masih dianggap "menutup bulan sebelumnya". */
export const OPNAME_PREV_MONTH_GRACE_DAYS = 5;

/** "2026-08" → "Agustus 2026". */
export function monthKeyToLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return key;
  return `${MONTH_LABELS_ID[m - 1]} ${y}`;
}
