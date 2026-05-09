/**
 * Sesi AE-12 — stock decimal precision helpers.
 *
 * Schema mengijinkan decimal stock (kg, L, gr, ml) via dual-column pattern:
 *   - bigint `current_stock` / `qty_delta`: legacy authoritative integer
 *   - numeric `current_stock_decimal` / `qty_delta_decimal`: precise mirror
 *
 * Helper ini centralize logic supaya semua stock-write paths consistent.
 * Server-only (dipakai di action.ts files yang server-side).
 */

/**
 * Resolve current decimal value dari row state. Prefer the decimal column
 * kalau populated; fallback ke bigint untuk legacy rows yang belum pernah
 * di-update via decimal-aware path.
 */
export function resolveStockDecimal(
  bigintValue: number,
  decimalValue: string | null,
): number {
  if (decimalValue !== null) {
    const parsed = parseFloat(decimalValue);
    if (Number.isFinite(parsed)) return parsed;
  }
  return bigintValue;
}

/**
 * Compute new stock state setelah a delta. Returns both bigint (rounded,
 * non-negative) + decimal (exact, can be 0+). Used di update statements.
 *
 * Stock floor at 0 — kalau delta negative bikin total negative, clamp ke 0
 * di bigint. Decimal mirrors that clamp untuk keep consistency.
 */
export function computeNewStock(opts: {
  currentBigint: number;
  currentDecimal: string | null;
  delta: number;
}): { bigint: number; decimal: string } {
  const oldDecimal = resolveStockDecimal(
    opts.currentBigint,
    opts.currentDecimal,
  );
  const newDecimal = Math.max(0, oldDecimal + opts.delta);
  return {
    bigint: Math.max(0, Math.round(newDecimal)),
    decimal: newDecimal.toFixed(4),
  };
}

/**
 * Format a movement delta value (signed) untuk insert. Decimal preserves
 * sign (negative = outflow). bigint rounds toward zero with sign preserved.
 */
export function formatMovementDelta(decimalDelta: number): {
  bigint: number;
  decimal: string;
} {
  const sign = decimalDelta < 0 ? -1 : 1;
  const absDecimal = Math.abs(decimalDelta);
  const absBigint = Math.round(absDecimal);
  return {
    bigint: sign * absBigint,
    decimal: decimalDelta.toFixed(4),
  };
}

/**
 * Display-side: format stock value preferring decimal, fallback bigint.
 * Returns formatted string e.g. "0,5" / "1" / "100" with id-ID locale,
 * up to 4 decimal places, trailing zeros trimmed.
 */
export function formatStockQty(
  bigintValue: number,
  decimalValue: string | null,
): string {
  const value = resolveStockDecimal(bigintValue, decimalValue);
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 4,
  }).format(value);
}

/**
 * Format stock with unit appended. e.g. "0,5 Kg", "100 Pcs".
 */
export function formatStockQtyWithUnit(
  bigintValue: number,
  decimalValue: string | null,
  unit: string,
): string {
  return `${formatStockQty(bigintValue, decimalValue)} ${unit}`;
}
