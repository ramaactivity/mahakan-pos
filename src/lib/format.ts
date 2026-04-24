/**
 * UI-facing formatters — Indonesian locale.
 *
 * This module re-exports the money and date helpers with names that read
 * naturally at call-sites (e.g. `formatAmount`, `formatDate`). The actual
 * integer arithmetic lives in `./money.ts`; calendar conversions in `./date.ts`.
 */

export {
  formatRupiah,
  formatRupiah as formatAmount,
  parseRupiah,
} from "./money";

export {
  formatIndonesianDate as formatDate,
  formatIndonesianDateTime as formatDateTime,
  formatIndonesianTime as formatTime,
} from "./date";

/** Format integer percent (0-100) as "10%". */
export function formatPercent(n: number): string {
  if (!Number.isInteger(n)) {
    throw new Error(`formatPercent: expected integer, got ${n}`);
  }
  return `${n}%`;
}

/** Truncate text with ellipsis for UI fit. */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}
