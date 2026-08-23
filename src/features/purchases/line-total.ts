/**
 * Sesi AE-216 — NILAI RUPIAH SATU BARIS PEMBELIAN.
 *
 * Harga satuan wajib rupiah BULAT (`purchase_items.unit_cost` bigint). Saat
 * staff mengetik Total Bayar, harga satuan diturunkan lewat pembagian yang
 * dibulatkan, jadi `qty × harga` TIDAK selalu kembali ke total yang diketik:
 *
 *   530 gr, total Rp 16.000 → harga = bulatkan(16.000 ÷ 530) = Rp 30/gr
 *   530 × 30 = Rp 15.900   ← meleset Rp 100 dari uang yang benar-benar dibayar
 *
 * Arahan owner (2026-08-23, sesudah melihat nota nyata): **total pembelian
 * dihitung dari TOTAL BAYAR.** Yang dibayar ke pedagang adalah kebenarannya;
 * harga satuan cuma cara melihatnya per satuan. Maka `totalCost` yang jadi
 * uang resmi baris itu, dan `qty × unitCost` hanya dipakai kalau staff
 * memang mengetik harga satuan (total-nya turunan, otomatis pas).
 *
 * Ini MEMBALIK keputusan sesi AE-214 yang sempat merapikan Total ke
 * `qty × harga`. Alasan pembalikan: dengan cara lama, nota Rp 227.000
 * tercatat Rp 226.880 — kas dan jurnal ikut meleset dari struk.
 */

/** Toleransi selisih yang WAJAR antara total yang diketik dan `qty × harga`.
 *
 * Karena harga satuan dibulatkan ke rupiah terdekat, selisihnya paling
 * besar setengah rupiah per satuan. Lebih dari itu berarti angkanya tidak
 * berpasangan (salah ketik, atau klien yang mengirim data ngawur) dan harus
 * ditolak — kalau tidak, `total_cost` bisa berisi nilai apa pun yang tidak
 * ada hubungannya dengan qty dan harga di baris yang sama.
 *
 * +1 rupiah sebagai bantalan pembulatan di ujung. */
export function lineTotalTolerance(qty: number): number {
  if (!Number.isFinite(qty) || qty <= 0) return 1;
  return Math.ceil(qty * 0.5) + 1;
}

/** Uang resmi satu baris. `totalCost` menang kalau ada dan masuk akal. */
export function resolveLineTotal(input: {
  qty: number;
  unitCost: number;
  /** Total bayar yang diketik staff. null/undefined = staff mengetik harga
   * satuan, jadi totalnya memang turunan `qty × harga`. */
  totalCost?: number | null;
}): number {
  const derived = Math.round(input.qty * input.unitCost);
  const typed = input.totalCost;
  if (typed === null || typed === undefined) return derived;
  if (!Number.isFinite(typed) || typed < 0) return derived;
  return typed;
}

/** Apakah `totalCost` berpasangan dengan qty × harga di baris yang sama?
 * Dipakai server sebagai rem sebelum menyimpan. */
export function isLineTotalConsistent(input: {
  qty: number;
  unitCost: number;
  totalCost?: number | null;
}): boolean {
  const typed = input.totalCost;
  if (typed === null || typed === undefined) return true;
  if (!Number.isFinite(typed) || typed < 0) return false;
  const derived = Math.round(input.qty * input.unitCost);
  return Math.abs(typed - derived) <= lineTotalTolerance(input.qty);
}
