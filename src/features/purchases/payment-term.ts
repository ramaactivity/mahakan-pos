/**
 * Sesi AE-190 — TOP (hari) bebas diisi berapa pun.
 *
 * Masalah yang diperbaiki (feedback owner): field "TOP (hari)" terasa terkunci
 * di 7. Penyebabnya effect sinkronisasi di modal yang berjalan pada SETIAP
 * perubahan `paymentTerm` — begitu user menghapus isinya (string kosong →
 * `parseInt` = NaN) effect langsung menulis balik "7", jadi angka baru numpuk
 * di belakang 7 ("714") atau kelihatan tidak bisa dihapus sama sekali.
 *
 * Aturan yang benar: default 7 hanya disodorkan SEKALI saat metode berpindah
 * ke TOP; setelah itu field milik user sepenuhnya, dan kebenarannya diperiksa
 * saat submit (sama seperti aturan server: TOP wajib 1..365, non-TOP = 0).
 *
 * Modul ini pure (tanpa React / DB) supaya bisa dipakai bareng oleh Catat
 * Pembelian, Edit PO, Tarik dari PR, dan form Supplier — sekaligus bisa diuji.
 */

/** Batas atas server (`createPurchaseSchema.paymentTermDays.max`). */
export const PAYMENT_TERM_MAX_DAYS = 365;

/** Saran awal saat metode pembayaran berpindah ke TOP. Bukan penguncian. */
export const PAYMENT_TERM_DEFAULT_DAYS = 7;

/**
 * Bersihkan ketikan user jadi angka hari yang wajar.
 *
 * - Non-digit dibuang (termasuk "-" dan ".", tempo hari selalu bulat positif).
 * - Dipotong 3 digit (>365 tetap ditolak saat submit, ini cuma cegah "99999").
 * - Nol di depan dirapikan ("007" → "7"), tapi "0" tunggal tetap "0".
 * - String kosong DIBIARKAN kosong — user sedang menghapus untuk mengetik
 *   ulang; jangan pernah isi otomatis di tengah pengetikan.
 */
export function sanitizePaymentTermInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 3);
  return digits.replace(/^0+(?=\d)/, "");
}

export type PaymentTermResult =
  | { ok: true; days: number }
  | { ok: false; message: string };

/**
 * Validasi saat submit. `isTop=false` selalu menghasilkan 0 (aturan server:
 * non-TOP wajib paymentTermDays === 0).
 */
export function resolvePaymentTermDays(
  raw: string,
  isTop: boolean,
): PaymentTermResult {
  if (!isTop) return { ok: true, days: 0 };
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, message: "TOP wajib diisi — berapa hari jatuh temponya?" };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, message: "TOP harus angka hari, mis. 14 atau 30" };
  }
  const days = Number(trimmed);
  if (days <= 0) return { ok: false, message: "TOP wajib > 0 hari" };
  if (days > PAYMENT_TERM_MAX_DAYS) {
    return {
      ok: false,
      message: `TOP maksimal ${PAYMENT_TERM_MAX_DAYS} hari`,
    };
  }
  return { ok: true, days };
}

/**
 * Nilai field saat metode berpindah ke TOP: pertahankan angka yang sudah valid
 * (user mungkin sudah mengetik 30 sebelum memilih TOP), selain itu sodorkan 7.
 */
export function paymentTermOnSwitchToTop(current: string): string {
  const res = resolvePaymentTermDays(current, true);
  return res.ok ? current.trim() : String(PAYMENT_TERM_DEFAULT_DAYS);
}

/**
 * Tanggal jatuh tempo yang AKAN dipakai server, untuk ditampilkan di bawah
 * field TOP — owner mengisi tempo manual mengikuti faktur, jadi dia perlu
 * lihat tanggalnya langsung tanpa hitung mundur di kepala.
 *
 * Sengaja meniru `addDaysIso` di actions.ts persis (aritmetika UTC atas
 * tanggal polos) supaya angka di layar = angka yang tersimpan. Kembalikan
 * null kalau tanggal/tempo belum sah — pemanggil menampilkan hint biasa.
 */
export function previewDueDateIso(
  purchaseDateIso: string,
  rawTerm: string,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDateIso)) return null;
  const term = resolvePaymentTermDays(rawTerm, true);
  if (!term.ok) return null;
  const d = new Date(`${purchaseDateIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + term.days);
  return d.toISOString().slice(0, 10);
}

/** Term default supplier: 0 sah (= cash on delivery). */
export function resolveSupplierTermDays(raw: string): PaymentTermResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, days: 0 };
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, message: "Term harus angka hari (0 = cash)" };
  }
  const days = Number(trimmed);
  if (days > PAYMENT_TERM_MAX_DAYS) {
    return { ok: false, message: `Term maksimal ${PAYMENT_TERM_MAX_DAYS} hari` };
  }
  return { ok: true, days };
}
