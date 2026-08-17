/**
 * Helper murni untuk field angka (`NumericInput`).
 *
 * Nilai yang disimpan komponen selalu string angka MENTAH: hanya digit,
 * pemisah desimal "." (bukan ","), tanpa titik ribuan. Dua fungsi di sini
 * yang jadi jembatan ke tampilan dan ke ketikan keyboard fisik.
 */

/** Angka mentah → tampilan id-ID ("1500000" → "1.500.000", "0.5" → "0,5"). */
export function formatDisplay(value: string, withThousands: boolean): string {
  if (value === "") return "";
  if (!withThousands) return value;
  const [intPart, decPart] = value.split(".");
  const intFormatted = intPart
    ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
    : "0";
  return decPart !== undefined ? `${intFormatted},${decPart}` : intFormatted;
}

/**
 * Teks yang diketik/di-paste di keyboard fisik → angka mentah.
 *
 * Aturannya disamakan dengan tombol keypad (`append` di NumericInput):
 * hanya digit, maksimal satu pemisah desimal (kalau `allowDecimal`),
 * nol di depan dibuang, dan panjang dipotong di `maxLength`. Paste
 * "Rp 1.500.000" ikut ke-strip jadi "1500000".
 */
export function sanitizeTyped(
  raw: string,
  allowDecimal: boolean,
  maxLength: number,
): string {
  let out = "";
  let dotUsed = false;
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") {
      out += ch;
      continue;
    }
    if ((ch === "." || ch === ",") && allowDecimal && !dotUsed) {
      dotUsed = true;
      out += out === "" ? "0." : ".";
    }
  }
  // "05" → "5" (sama seperti append()); "0" dan "0.5" dibiarkan utuh.
  out = out.replace(/^0+(?=\d)/, "");
  return out.slice(0, maxLength);
}
