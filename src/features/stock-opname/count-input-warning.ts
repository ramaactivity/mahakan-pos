/**
 * Sesi AE-196 — deteksi ketikan hitungan opname yang hampir pasti salah
 * skala, SEBELUM angkanya jadi laporan.
 *
 * Kejadian nyata (opname 30 Juni 2026): lima bahan tersimpan seperseribu
 * dari nilai sebenarnya — Powder Red Velvet 1,3810 gr (maksudnya 1.381 gr),
 * Garnish 0,2930 gr (293 gr), Butterscoth 0,9868 ml (986,8 ml). Sebabnya
 * kolom hitungan mem-parse "1.381" dengan `parseFloat`, sementara staff
 * mengetik titik sebagai pemisah ribuan (atau menyalin angka timbangan yang
 * masih dalam kilogram). Akibatnya bulan itu pemakaiannya melonjak dan bulan
 * berikutnya minus.
 *
 * Pilihan sengaja: PERINGATAN, bukan koreksi otomatis. "0.500" bisa berarti
 * 500 (ribuan) atau 0,5 (desimal) — hanya orang yang memegang timbangan yang
 * tahu. Menebak diam-diam justru menciptakan kesalahan jenis baru.
 */

/** Satuan halus: pecahan di bawah 1 secara praktis mustahil dihitung manual. */
const FINE_UNITS = new Set(["gr", "g", "gram", "ml", "pcs", "lembar", "butir"]);

/** "1.381", "12.500", "1.337,8" — titik sebagai pemisah ribuan. */
const THOUSAND_SEPARATOR = /^\d{1,3}(\.\d{3})+(,\d+)?$/;

export interface CountInputWarningArgs {
  /** Isi kolom apa adanya, sebelum di-parse. */
  raw: string;
  /** Hasil akhir dalam satuan resep (sesudah konversi satuan), null = kosong. */
  totalQty: number | null;
  /** Satuan resep/master bahan, mis. "gr" | "ml" | "Kg". */
  recipeUnit: string;
}

/**
 * Kembalikan kalimat peringatan untuk staff, atau null kalau ketikannya wajar.
 * Murni — aman dipanggil tiap ketukan tombol.
 */
export function countInputWarning({
  raw,
  totalQty,
  recipeUnit,
}: CountInputWarningArgs): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  if (THOUSAND_SEPARATOR.test(trimmed)) {
    const asThousands = trimmed.replace(/\./g, "").replace(",", ".");
    return `Titik dibaca sebagai koma, jadi ini tersimpan ${trimmed.replace(".", ",")} — bukan ${Number(asThousands).toLocaleString("id-ID")}. Kalau maksudmu ${Number(asThousands).toLocaleString("id-ID")}, ketik tanpa titik.`;
  }

  if (totalQty === null || !Number.isFinite(totalQty) || totalQty <= 0) {
    return null;
  }

  const fine = FINE_UNITS.has(recipeUnit.trim().toLowerCase());
  if (fine && totalQty < 10 && !Number.isInteger(totalQty)) {
    return `${totalQty.toLocaleString("id-ID")} ${recipeUnit} itu jumlah yang sangat kecil. Kalau kamu menimbang dalam kilogram/liter, ganti satuan di sebelah kolom ini — jangan ketik angka kilogramnya di kolom ${recipeUnit}.`;
  }

  return null;
}
