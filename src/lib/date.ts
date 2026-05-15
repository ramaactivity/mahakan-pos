/**
 * Date utilities — timezone-aware for Asia/Jakarta (WIB, UTC+7).
 *
 * All DB timestamps are stored UTC (timestamptz). UI displays should
 * always be in WIB. Helpers here bridge that.
 */

import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";

export const JAKARTA_TZ = "Asia/Jakarta";

/**
 * Convert a UTC Date (or ISO string) to a Jakarta-zoned Date.
 * The returned Date's local fields (getHours, getDate, etc.) reflect WIB.
 */
export function toJakartaDate(input: Date | string): Date {
  const d = typeof input === "string" ? new Date(input) : input;
  return toZonedTime(d, JAKARTA_TZ);
}

/** Format as DD/MM/YYYY (Indonesian convention). Operates on WIB-adjusted date. */
export function formatIndonesianDate(input: Date | string): string {
  return format(toJakartaDate(input), "dd/MM/yyyy");
}

/** Format as DD/MM/YYYY HH:mm WIB. */
export function formatIndonesianDateTime(input: Date | string): string {
  return `${format(toJakartaDate(input), "dd/MM/yyyy HH:mm")} WIB`;
}

/** Format as HH:mm (WIB). */
export function formatIndonesianTime(input: Date | string): string {
  return format(toJakartaDate(input), "HH:mm");
}

/**
 * Format a date as `TRX-YYYYMMDD` prefix for transaction number.
 * Uses WIB calendar day.
 */
export function formatTransactionDatePart(input: Date | string): string {
  return format(toJakartaDate(input), "yyyyMMdd");
}

/**
 * Returns ISO date string (YYYY-MM-DD) in WIB. Useful for DB `date` columns
 * (expense_date, income_date) that should be "business day" not UTC day.
 */
export function toJakartaDateOnly(input: Date | string): string {
  return format(toJakartaDate(input), "yyyy-MM-dd");
}

/**
 * Sesi AE-29 — convert Jakarta calendar date (YYYY-MM-DD) ke UTC ISO range
 * yang merepresentasikan 00:00:00.000 — 23:59:59.999 WIB pada hari itu.
 *
 * Critical untuk filter "today" di POS panels (HistoryPanel, OrderQueuePanel,
 * dll). Sebelumnya semua call site pakai pola WRONG:
 *   `${today}T00:00:00.000Z` to `${today}T23:59:59.999Z`
 * Itu UTC range bukan WIB range — exclude transaksi yang dibuat 00:00-06:59
 * WIB (= 17:00-23:59 UTC hari sebelumnya). Akibatnya transaksi dini hari
 * Jakarta tidak muncul sampai polling 30s nanti pagi.
 *
 * Example: jakartaYmd = "2026-05-11"
 *   from = 2026-05-10T17:00:00.000Z (= 2026-05-11 00:00 WIB)
 *   to   = 2026-05-11T16:59:59.999Z (= 2026-05-11 23:59:59.999 WIB)
 */
export function wibDayRangeUtc(jakartaYmd: string): {
  from: string;
  to: string;
} {
  const fromDate = new Date(`${jakartaYmd}T00:00:00.000+07:00`);
  const toDate = new Date(`${jakartaYmd}T23:59:59.999+07:00`);
  return {
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
  };
}

/**
 * Convenience: Jakarta "today" range as UTC ISO. Pakai server clock kalau
 * dipanggil tanpa input (mostly client side).
 */
export function todayWibRangeUtc(): { from: string; to: string } {
  return wibDayRangeUtc(toJakartaDateOnly(new Date()));
}

/**
 * Sesi AE-58 — Range tanggal kalender bulan WIB sebagai YYYY-MM-DD ISO
 * dates (untuk dipakai di fetchHppReport yang accept dateFrom/dateTo string).
 *
 * Input: "YYYY-MM" (e.g., "2026-05")
 * Output: { fromIso: "YYYY-MM-01", toIso: "YYYY-MM-LAST" } sesuai jumlah hari
 *   bulan tersebut (28/29 Februari, 30/31 lainnya).
 *
 * Throw kalau format input invalid (defensive — caller harus pastikan).
 */
export function monthWibRangeUtc(yyyymm: string): {
  fromIso: string;
  toIso: string;
} {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yyyymm)) {
    throw new Error(`monthWibRangeUtc: invalid format "${yyyymm}", expected YYYY-MM`);
  }
  const [yearStr, monthStr] = yyyymm.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  // new Date(Y, M, 0) → last day of month M (1-indexed in this idiom because
  // M=5 means "month after April" → day 0 = last day of April; jadi pakai
  // month tanpa -1 untuk dapat last day of target month).
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    fromIso: `${yyyymm}-01`,
    toIso: `${yyyymm}-${String(lastDay).padStart(2, "0")}`,
  };
}

/**
 * Sesi AE-58 — Bulan kalender WIB hari ini ("YYYY-MM"). Default untuk
 * month picker di Inventory monthly view.
 */
export function currentJakartaMonth(): string {
  return toJakartaDateOnly(new Date()).slice(0, 7);
}

/**
 * Day-of-week key as used in OperationalHours JSONB ("mon"…"sun"), based on
 * WIB calendar day of the input date.
 */
export function jakartaDowKey(
  input: Date | string,
): "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun" {
  const wib = toJakartaDate(input);
  const map = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
  return map[wib.getDay()];
}

/**
 * Combine an WIB calendar date with an "HH:mm" time string into a UTC Date.
 * Used to derive expected shift close time from outlet operationalHours.
 * Returns null if `time` is missing or malformed.
 *
 * Note: produces an instant (Date object) by interpreting the time as WIB
 * wall-clock on the same calendar day as `baseDate` (WIB). Caller should
 * compare against `new Date()` (server-clock UTC) without further offset
 * juggling — both are absolute instants.
 */
export function combineJakartaDateAndTime(
  baseDate: Date | string,
  time: string | null | undefined,
): Date | null {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [hh, mm] = time.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  // Build the WIB local datetime as an ISO string with the +07:00 offset,
  // then parse it back as a UTC Date instant.
  const ymd = toJakartaDateOnly(baseDate);
  return new Date(
    `${ymd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+07:00`,
  );
}
