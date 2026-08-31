/**
 * Sesi AE-196 — aturan "kode compliment ini boleh dipakai untuk transaksi
 * ini?" dikumpulkan jadi satu fungsi murni.
 *
 * Sebelumnya aturannya ditulis ulang di dua tempat (createTransaction dan
 * editOpenBill) dengan perbedaan halus, dan tidak ada satu pun tes yang
 * menjaganya — padahal ini gerbang yang menentukan makanan bisa digratiskan
 * atau tidak. Sekarang kedua jalur memanggil fungsi yang sama.
 */

/**
 * Sesi AE-208 — apakah diskon ini masih perlu PIN approver?
 *
 * Compliment TIDAK. Sejak AE-195 compliment disetujui lewat kode 6 digit
 * Owner (checkComplimentApproval di bawah), sementara gerbang diskon lama
 * menuntut PIN approver untuk semua diskon staff. Dua gerbang itu bertabrakan:
 * kasir yang sudah memegang kode Owner tetap ditolak APPROVER_REQUIRED, jadi
 * compliment mustahil diselesaikan kasir — tombol "Konfirmasi Bayar Rp 0"
 * seolah mati.
 */
export function requiresPinApprover({
  discountAmount,
  role,
  isCompliment,
}: {
  discountAmount: number;
  role: string;
  isCompliment: boolean;
}): boolean {
  return discountAmount > 0 && role === "staff" && !isCompliment;
}
