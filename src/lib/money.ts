/**
 * Money utilities — Mahakan POS.
 *
 * INVARIANT: All rupiah amounts are integers (satuan rupiah).
 * Never introduce floats or decimal types for money.
 *
 * Rounding: banker's rounding (round half to even) for percent discounts.
 * See docs/03-TSD.md §9 and docs/09-TESTING-STRATEGY.md §3.1.
 */

export type DiscountType = "fixed" | "percent";

export interface Discount {
  type: DiscountType;
  /** For `fixed`: amount in rupiah. For `percent`: 0-100 integer. */
  value: number;
}

const MIN_PRICE = 0;
const MAX_PRICE = 999_999_999;

/**
 * Banker's rounding — round half to even.
 * Example: 12.5 → 12, 13.5 → 14, 12.4 → 12, 12.6 → 13.
 */
export function bankersRound(n: number): number {
  if (!Number.isFinite(n)) {
    throw new Error("bankersRound: non-finite input");
  }
  const floor = Math.floor(n);
  const diff = n - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  // exactly .5 — round to even
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Compute the discount amount (in rupiah) given subtotal + discount spec.
 *
 * - Null discount → 0
 * - Fixed: returns value, capped at subtotal, floored at 0 (defensive)
 * - Percent: round(subtotal * percent / 100) via banker's rounding
 */
export function computeDiscountAmount(
  subtotal: number,
  discount: Discount | null,
): number {
  assertIntegerAmount(subtotal, "subtotal");
  if (discount === null) return 0;
  assertIntegerAmount(discount.value, "discount.value", { allowNegative: true });

  if (discount.type === "fixed") {
    if (discount.value <= 0) return 0;
    return Math.min(discount.value, subtotal);
  }

  // percent
  const pct = discount.value;
  if (pct <= 0) return 0;
  if (pct >= 100) return subtotal;
  // Keep math in integer domain as much as possible:
  //   subtotal * pct is integer (both integers) up to ~10^11, safe within Number.MAX_SAFE_INTEGER
  //   divide by 100 with banker's rounding
  const numerator = subtotal * pct;
  const quotient = Math.floor(numerator / 100);
  const remainder = numerator - quotient * 100;
  if (remainder < 50) return quotient;
  if (remainder > 50) return quotient + 1;
  // exactly .5
  return quotient % 2 === 0 ? quotient : quotient + 1;
}

/**
 * Compute transaction total = subtotal - discountAmount, floored at 0.
 */
export function computeTotal(subtotal: number, discountAmount: number): number {
  assertIntegerAmount(subtotal, "subtotal");
  assertIntegerAmount(discountAmount, "discountAmount");
  return Math.max(0, subtotal - discountAmount);
}

/**
 * Compute line-item subtotal = (unitPrice + modifiersPriceDelta) * quantity.
 */
export function computeItemSubtotal(
  unitPrice: number,
  modifiersPriceDelta: number,
  quantity: number,
): number {
  assertIntegerAmount(unitPrice, "unitPrice");
  assertIntegerAmount(modifiersPriceDelta, "modifiersPriceDelta", {
    allowNegative: true,
  });
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error(`computeItemSubtotal: invalid quantity ${quantity}`);
  }
  if (quantity === 0) return 0;
  return (unitPrice + modifiersPriceDelta) * quantity;
}

/**
 * Format rupiah as Indonesian-style string: "Rp 1.250.000".
 * Negative values: "Rp -10.000".
 *
 * Sesi AE-63 phase7 — DEFENSIVE: round non-integer + handle NaN/Infinity.
 * Pre-fix throw "amount must be an integer, got X.Y" → crashes UI when
 * caller passes computed total dari decimal arithmetic (mis. opname
 * preview accumulate decimal qty × bigint cost). Strict integer
 * assertion belong di STORAGE boundary (Zod refine, bigint write),
 * BUKAN di display function — display function should be forgiving.
 *
 * Behavior:
 *  - integer → format as-is
 *  - decimal → round-half-to-even
 *  - NaN / Infinity → "Rp 0" (defensive, log to console)
 */
export function formatRupiah(amount: number): string {
  if (!Number.isFinite(amount)) {
    if (typeof window !== "undefined") {
      console.warn("[formatRupiah] non-finite input, fallback Rp 0", amount);
    }
    return "Rp 0";
  }
  const rounded = Number.isInteger(amount) ? amount : Math.round(amount);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  // Insert thousand separators (period per Indonesian convention)
  const grouped = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `Rp ${sign}${grouped}`;
}

/**
 * Sesi AE-164 — format Rupiah untuk nilai KECIL / rate per-unit yang bisa
 * < Rp 1 (mis. effective cost per gram). `formatRupiah()` selalu membulatkan
 * ke integer → Rp 0,36/g tampil "Rp 0" yang dikira error / belum terhitung.
 * Helper ini menampilkan desimal saat |nilai| < 100; untuk ≥ 100 atau
 * integer, delegasi ke formatRupiah (pemisah ribuan).
 *
 * Desimal adaptif: |x|≥10 → 1, |x|≥1 → 2, |x|<1 → 3. Trailing zero dibuang,
 * pemisah desimal koma (konvensi Indonesia).
 */
export function formatRupiahPrecise(amount: number): string {
  if (!Number.isFinite(amount)) return "Rp 0";
  if (Number.isInteger(amount) || Math.abs(amount) >= 100) {
    return formatRupiah(amount);
  }
  const abs = Math.abs(amount);
  if (abs === 0) return "Rp 0";
  const decimals = abs >= 10 ? 1 : abs >= 1 ? 2 : 3;
  const sign = amount < 0 ? "-" : "";
  let s = abs.toFixed(decimals);
  s = s.replace(/\.?0+$/, ""); // buang trailing zero: "0.360"→"0.36"
  s = s.replace(".", ","); // pemisah desimal Indonesia
  return `Rp ${sign}${s}`;
}

/**
 * Parse rupiah string to integer.
 * Accepts: "1.250.000", "Rp 1.250.000", "1250000".
 * Throws on non-numeric input after stripping.
 */
export function parseRupiah(input: string): number {
  if (typeof input !== "string") {
    throw new Error("parseRupiah: non-string input");
  }
  const cleaned = input.replace(/Rp\s*/gi, "").replace(/\./g, "").trim();
  if (cleaned === "" || !/^-?\d+$/.test(cleaned)) {
    throw new Error(`parseRupiah: cannot parse "${input}"`);
  }
  return parseInt(cleaned, 10);
}

/**
 * Validate that an amount is within allowed price range.
 * Used at input boundary (Zod refines, Server Actions).
 */
export function isValidPriceRange(amount: number): boolean {
  return (
    Number.isInteger(amount) && amount >= MIN_PRICE && amount <= MAX_PRICE
  );
}

function assertIntegerAmount(
  n: number,
  fieldName: string,
  opts: { allowNegative?: boolean } = {},
): void {
  if (!Number.isInteger(n)) {
    throw new Error(`${fieldName} must be an integer, got ${n}`);
  }
  if (!opts.allowNegative && n < 0) {
    throw new Error(`${fieldName} must be non-negative, got ${n}`);
  }
}
