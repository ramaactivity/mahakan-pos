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
