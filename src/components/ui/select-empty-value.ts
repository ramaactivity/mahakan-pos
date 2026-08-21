/**
 * Sesi AE-213 — jembatan untuk opsi bernilai string kosong di `Select`.
 *
 * KENAPA ADA: Radix Select MELEMPAR error keras kalau ada `<Select.Item>`
 * bernilai "" —
 *
 *   "A <Select.Item /> must have a value prop that is not an empty string."
 *
 * dan itu terjadi bahkan saat dropdown-nya masih tertutup, karena Radix tetap
 * merender seluruh Item ke DocumentFragment untuk membaca label yang terpilih.
 * Jadi satu opsi "— tidak dipilih —" yang tampak sepele = seluruh layar mati,
 * bukan sekadar dropdown yang error. Persis yang terjadi di modul Aset Tetap
 * (sesi AE-212: opsi "— pakai pilihan Bayar dari di atas —").
 *
 * Sementara "" ITU SENDIRI adalah cara yang wajar untuk bilang "kosong /
 * pakai bawaan", dan pemanggil tidak boleh dipaksa mengarang sentinel
 * sendiri-sendiri di tiap layar (yang berarti bug ini tinggal menunggu
 * dipanggil ulang). Jadi terjemahannya ditaruh di dalam `Select`: ke Radix
 * dikirim sentinel, ke pemanggil tetap "".
 *
 * Sentinelnya sengaja bukan string yang mungkin jadi kode akun / id / satuan.
 */

export const EMPTY_VALUE_SENTINEL = "__mahakan_empty_option__";

/** "" → sentinel. Nilai lain lewat apa adanya. */
export function encodeSelectValue(value: string): string {
  return value === "" ? EMPTY_VALUE_SENTINEL : value;
}

/** sentinel → "". Kebalikan `encodeSelectValue`. */
export function decodeSelectValue(value: string): string {
  return value === EMPTY_VALUE_SENTINEL ? "" : value;
}

/**
 * Apakah daftar opsinya memang punya opsi bernilai ""?
 *
 * Penting: penerjemahan `value=""` di tingkat Root HANYA boleh jalan kalau
 * opsi kosong itu ada. Di layar lain, `value=""` justru berarti "belum ada
 * yang dipilih" dan Radix memakainya untuk memunculkan placeholder — kalau
 * ikut diterjemahkan jadi sentinel, placeholder-nya hilang dan trigger-nya
 * tampak melompong.
 */
export function hasEmptyOption(
  options?: ReadonlyArray<{ value: string }>,
  groups?: ReadonlyArray<{ options: ReadonlyArray<{ value: string }> }>,
): boolean {
  if (options?.some((o) => o.value === "")) return true;
  return Boolean(groups?.some((g) => g.options.some((o) => o.value === "")));
}
