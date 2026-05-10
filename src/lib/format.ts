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

/**
 * Sesi AE-30 — parse Indonesian-format number string ke JS number.
 *
 * Format Indonesia: titik = thousand separator, koma = decimal.
 * Contoh: "36.000" → 36000, "Rp 1.500.000" → 1500000, "1,5" → 1.5,
 * "10.000,50" → 10000.50, "1.5" → 1.5 (single dot + non-3-digits).
 *
 * Heuristik:
 *   1. Strip prefix/suffix non-numeric (Rp, spasi, satuan), keep . , - dan digit.
 *   2. Kalau ada koma → koma = decimal point. Strip semua titik (thousand),
 *      replace koma dengan titik. parseFloat.
 *   3. Kalau cuma titik:
 *      - Multiple titik → semua thousand separator. Strip semua.
 *      - Single titik AND digit-after-dot exactly 3 (e.g. "1.000") →
 *        thousand separator. Strip.
 *      - Single titik AND digit-after-dot != 3 (e.g. "1.5") → decimal.
 *        Keep.
 *   4. Tidak ada titik / koma → parseFloat as-is.
 *
 * Returns NaN kalau input invalid / kosong.
 */
export function parseIndonesianNumber(input: string): number {
  if (!input) return NaN;
  let s = input.replace(/[^\d.,-]/g, "").trim();
  if (!s) return NaN;
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
    return parseFloat(s);
  }
  const dotCount = (s.match(/\./g) ?? []).length;
  if (dotCount > 1) {
    return parseFloat(s.replace(/\./g, ""));
  }
  if (dotCount === 1) {
    const parts = s.split(".");
    const after = parts[1] ?? "";
    if (after.length === 3) {
      return parseFloat(s.replace(".", ""));
    }
    return parseFloat(s);
  }
  return parseFloat(s);
}

/** Indonesian integer parse — wraps parseIndonesianNumber + Math.round.
 *  Cocok untuk harga rupiah yang selalu integer. */
export function parseIndonesianInt(input: string): number {
  const n = parseIndonesianNumber(input);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n);
}
