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
