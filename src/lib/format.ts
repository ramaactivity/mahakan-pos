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

/** Format percent (0-100) as "10%".
 *
 * Sesi AE-63 phase7 — DEFENSIVE: same fix as formatRupiah. Display
 * function should not throw on non-integer (caller may pass computed
 * value). Round to integer instead. NaN/Infinity → "0%" + warn. */
export function formatPercent(n: number): string {
  if (!Number.isFinite(n)) {
    if (typeof window !== "undefined") {
      console.warn("[formatPercent] non-finite input, fallback 0%", n);
    }
    return "0%";
  }
  const rounded = Number.isInteger(n) ? n : Math.round(n);
  return `${rounded}%`;
}

/** Truncate text with ellipsis for UI fit. */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

/**
 * Sesi AE-30 / AE-136 — parse Indonesian-format number string ke JS number.
 *
 * **Konvensi sistem Mahakan POS (STRICT Indonesian):**
 *   - titik (`.`) = pemisah ribuan ("1.234.567" = 1234567)
 *   - koma (`,`) = pemisah desimal ("0,5" = 0.5)
 *   - Format Inggris ("0.5" untuk setengah, "1,234.56") DITOLAK kecuali
 *     mode lenient.
 *
 * **Mode `strict` (default):**
 *   - "1.234"           → 1234        (titik ribuan, 3 digit ekor)
 *   - "1.234.567"       → 1234567     (multi-titik ribuan)
 *   - "0,5"             → 0.5
 *   - "1.234,56"        → 1234.56
 *   - "1234"            → 1234        (plain integer)
 *   - "0.5"             → NaN         (ambiguous! user harus pakai "0,5")
 *   - "1,234,567"       → NaN         (format Inggris ditolak)
 *   - "1.23"            → NaN         (titik bukan posisi ribuan)
 *   - "1.5"             → NaN         (ambiguous; harus "1,5")
 *   - "0,5,1"           → NaN         (koma ganda invalid)
 *
 * **Mode `lenient`** (opt-in via `{ strict: false }`):
 *   - Sama dengan strict + accept "0.5" sebagai 0.5 dan "1.5" sebagai 1.5.
 *   - Dipakai untuk import CSV / data legacy / paste dari user yang mungkin
 *     mix format.
 *
 * Common preprocessing untuk keduanya:
 *   - Strip prefix/suffix non-numeric (Rp, spasi, satuan), keep `.,-` + digit
 *   - Strip negative sign valid hanya kalau di awal
 *
 * Returns NaN kalau input invalid / kosong / format Inggris (strict).
 */
export function parseIndonesianNumber(
  input: string,
  opts: { strict?: boolean } = {},
): number {
  const strict = opts.strict !== false; // default strict
  if (!input || typeof input !== "string") return NaN;
  let s = input.replace(/[^\d.,-]/g, "").trim();
  if (!s) return NaN;

  /* Validasi sign: kalau ada "-" harus di awal saja. */
  const negCount = (s.match(/-/g) ?? []).length;
  if (negCount > 1) return NaN;
  if (negCount === 1 && !s.startsWith("-")) return NaN;
  const negative = s.startsWith("-");
  if (negative) s = s.slice(1);
  if (!s) return NaN;

  const commaCount = (s.match(/,/g) ?? []).length;
  const dotCount = (s.match(/\./g) ?? []).length;

  if (commaCount > 1) return NaN; // koma ganda invalid

  if (commaCount === 1) {
    /* Indonesian decimal: koma di akhir, titik (jika ada) = ribuan. */
    const [intPart, decPart] = s.split(",");
    /* decPart valid kalau >= 1 digit, no titik di dalamnya */
    if (!decPart || decPart.length === 0 || decPart.includes(".")) return NaN;
    /* intPart: kalau ada titik, semua harus pola ribuan (group 3 digit) */
    if (intPart.includes(".")) {
      if (!isValidThousandPattern(intPart)) return NaN;
    } else if (intPart.length === 0) {
      /* ",5" → invalid, butuh "0,5" */
      return NaN;
    }
    const cleaned = intPart.replace(/\./g, "") + "." + decPart;
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? (negative ? -n : n) : NaN;
  }

  /* Hanya titik (atau plain). */
  if (dotCount === 0) {
    const n = parseFloat(s);
    return Number.isFinite(n) ? (negative ? -n : n) : NaN;
  }

  /* Single atau multi titik: validasi pola ribuan strict. */
  if (isValidThousandPattern(s)) {
    const n = parseFloat(s.replace(/\./g, ""));
    return Number.isFinite(n) ? (negative ? -n : n) : NaN;
  }

  /* Pola tidak valid sebagai ribuan. Strict mode: NaN. Lenient: treat as
   * English decimal (single titik). */
  if (strict) return NaN;
  if (dotCount === 1) {
    const n = parseFloat(s);
    return Number.isFinite(n) ? (negative ? -n : n) : NaN;
  }
  return NaN;
}

/**
 * Cek apakah string match pola ribuan Indonesia:
 *   - "1.234"          ✓ (1-3 digit + (.\d{3})+ )
 *   - "12.345"         ✓
 *   - "123.456"        ✓
 *   - "1.234.567"      ✓
 *   - "1.23"           ✗ (digit setelah titik harus tepat 3)
 *   - "12.3456"        ✗
 *   - "0.5"            ✗
 *   - "1234"           ✓ (no dot, plain)
 */
function isValidThousandPattern(s: string): boolean {
  if (s.length === 0) return false;
  if (!s.includes(".")) return /^\d+$/.test(s);
  /* Pattern: [1-3 digit] (.[3 digit])+ */
  return /^\d{1,3}(\.\d{3})+$/.test(s);
}

/** Indonesian integer parse — wraps parseIndonesianNumber + Math.round.
 *  Cocok untuk harga rupiah yang selalu integer. */
export function parseIndonesianInt(input: string): number {
  const n = parseIndonesianNumber(input);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n);
}
