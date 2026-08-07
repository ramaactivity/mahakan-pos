/**
 * Label pembelian untuk deskripsi jurnal / Buku Besar.
 *
 * Sebelumnya deskripsi jurnal pembelian memakai potongan UUID sebagai label
 * (`Bayar hutang purchase 376b5626`) — benar buat mesin, tapi Owner yang buka
 * Buku Besar tidak tahu itu hutang ke supplier siapa. Modul ini membangun
 * label yang langsung terbaca:
 *
 *   "Toko Sari, nota INV-12 (05 Agu 2026)"
 *   "Toko Sari (terima 05 Agu 2026)"        ← jurnal dari Goods Receipt
 *   "Tanpa supplier (05 Agu 2026)"          ← belanja pasar / walk-in
 *
 * PURE — tanpa akses DB, supaya bisa dipakai mapper akuntansi (unit-tested)
 * maupun server action. Resolusi nama supplier dari DB ada di
 * `purchases/actions.ts` (`resolvePurchaseLabel`).
 */

export type PurchasePaymentMethodLike =
  | "cash"
  | "transfer_bca"
  | "transfer_bri"
  | "transfer_other"
  | "top";

const BULAN_SINGKAT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

/**
 * "2026-08-05" → "05 Agu 2026". Input sudah tanggal kalender WIB (kolom
 * `date` Postgres), jadi cukup di-parse literal — TIDAK boleh lewat
 * `new Date()` yang menggeser timezone.
 */
export function formatTanggalIndo(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, year, month, day] = m;
  const bulan = BULAN_SINGKAT[Number(month) - 1] ?? month;
  return `${day} ${bulan} ${year}`;
}

/** Nama metode bayar yang dibaca manusia — jangan pernah tulis enum mentah. */
export function labelMetodeBayar(m: PurchasePaymentMethodLike): string {
  switch (m) {
    case "cash":
      return "Tunai";
    case "transfer_bca":
      return "Transfer BCA";
    case "transfer_bri":
      return "Transfer BRI";
    case "transfer_other":
      return "Transfer bank lain";
    case "top":
      return "Tempo (bayar nanti)";
  }
}

export type PurchaseLabelParts = {
  /** Nama supplier. Null/kosong = belanja pasar atau walk-in tanpa supplier. */
  supplierName?: string | null;
  /** Nomor nota/invoice dari supplier. */
  invoiceNo?: string | null;
  /** Tanggal pembelian (YYYY-MM-DD). */
  purchaseDate?: string | null;
  /**
   * Tanggal barang diterima (Goods Receipt). Kalau diisi, dia yang tampil —
   * jurnal GR memang dicatat pada tanggal terima, bukan tanggal PO.
   */
  receiptDate?: string | null;
};

/**
 * Bangun label pembelian yang enak dibaca. Format:
 *   `<Supplier>, nota <No> (<tanggal>)`
 * Bagian yang datanya tidak ada otomatis dilewati, jadi tidak pernah muncul
 * "nota null" atau kurung kosong.
 */
export function buildPurchaseLabel(parts: PurchaseLabelParts): string {
  const supplier = parts.supplierName?.trim();
  const invoice = parts.invoiceNo?.trim();

  const segments: string[] = [supplier && supplier.length > 0 ? supplier : "Tanpa supplier"];
  if (invoice && invoice.length > 0) segments.push(`nota ${invoice}`);

  const tanggal = parts.receiptDate
    ? `terima ${formatTanggalIndo(parts.receiptDate)}`
    : parts.purchaseDate
      ? formatTanggalIndo(parts.purchaseDate)
      : null;

  const head = segments.join(", ");
  return tanggal ? `${head} (${tanggal})` : head;
}
