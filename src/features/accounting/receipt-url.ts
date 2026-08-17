/**
 * Sesi AE-206 — sanitasi URL bukti transaksi jurnal manual.
 *
 * URL yang tersimpan nanti dirender sebagai tautan yang bisa diklik di daftar
 * Jurnal ("Lihat bukti"), jadi isinya tidak boleh sembarang skema: `javascript:`
 * atau `data:` yang lolos ke DB akan jalan di browser orang yang mengkliknya.
 * Hanya http/https yang diterima; selain itu (dan string kosong) → null.
 *
 * Dipisah dari actions.ts supaya bisa dites tanpa menyentuh DB/sesi.
 */
export function normalizeReceiptUrl(
  raw: string | null | undefined,
): string | null {
  const url = raw?.trim();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return url.slice(0, 2000);
  } catch {
    /* Bukan URL absolut yang sah (mis. path relatif atau teks acak). */
    return null;
  }
}
