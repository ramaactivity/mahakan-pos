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

export interface ComplimentCodeRow {
  outletId: string;
  /** Kasir yang memasukkan kode di modal. */
  consumedByUserId: string | null;
  /** Transaksi yang sudah memakai kode ini, null kalau belum. */
  usedForTransactionId: string | null;
  /** Alasan yang benar-benar disetujui owner. */
  reason: string;
  /** Nilai keranjang saat owner menyetujui. NULL = kode lama, tidak dicek. */
  approvedAmount: number | null;
}

export interface ComplimentGuardInput {
  /** Baris approval_codes, null kalau id-nya tidak ketemu. */
  row: ComplimentCodeRow | null;
  outletId: string;
  userId: string;
  /** Alasan diskon di transaksi, harus persis sama dengan yang disetujui. */
  discountReason: string;
  /** Subtotal transaksi yang sedang dibuat/diedit. */
  subtotal: number;
  /**
   * Untuk editOpenBill: id bill yang sedang diedit. Kode yang sudah tertaut
   * ke bill INI boleh dipakai lagi (kasir mengedit bill yang sama), kode yang
   * tertaut ke transaksi lain tidak.
   */
  allowLinkedTransactionId?: string | null;
}

export type ComplimentGuardResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

export function checkComplimentApproval({
  row,
  outletId,
  userId,
  discountReason,
  subtotal,
  allowLinkedTransactionId = null,
}: ComplimentGuardInput): ComplimentGuardResult {
  if (!row) {
    return {
      ok: false,
      code: "COMPLIMENT_APPROVAL_INVALID",
      message: "Kode approval compliment tidak dikenali. Minta kode baru ke Owner.",
    };
  }

  if (row.outletId !== outletId || row.consumedByUserId !== userId) {
    return {
      ok: false,
      code: "COMPLIMENT_APPROVAL_INVALID",
      message: "Kode approval compliment tidak dikenali. Minta kode baru ke Owner.",
    };
  }

  const linkedElsewhere =
    row.usedForTransactionId !== null &&
    row.usedForTransactionId !== allowLinkedTransactionId;
  if (linkedElsewhere) {
    return {
      ok: false,
      code: "COMPLIMENT_APPROVAL_ALREADY_USED",
      message: "Kode approval compliment sudah dipakai transaksi lain. Minta kode baru.",
    };
  }

  if (row.reason !== discountReason) {
    return {
      ok: false,
      code: "COMPLIMENT_REASON_MISMATCH",
      message:
        "Alasan compliment berbeda dari yang disetujui Owner. Minta kode baru dengan alasan yang benar.",
    };
  }

  /* Owner menyetujui SEBESAR keranjang saat itu. Keranjang yang menyusut
   * (item dibatalkan) tetap boleh — yang dilarang membengkak. */
  if (row.approvedAmount !== null && subtotal > row.approvedAmount) {
    return {
      ok: false,
      code: "COMPLIMENT_AMOUNT_EXCEEDED",
      message: `Kode ini disetujui untuk keranjang Rp ${row.approvedAmount.toLocaleString("id-ID")}, sedangkan sekarang Rp ${subtotal.toLocaleString("id-ID")}. Minta kode baru ke Owner.`,
    };
  }

  return { ok: true };
}
