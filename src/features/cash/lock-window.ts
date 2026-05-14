/**
 * Sesi AE-49 — pure helper untuk cek apakah expense/income di-edit/delete
 * akan berdampak ke shift yang sudah tutup. Kalau iya, harus REJECT supaya
 * variance laporan tutup shift tidak silently corrupt setelah closed.
 *
 * Owner directive: hard reject (bukan warn). Workaround buat owner: bikin
 * "reversing entry" — pengeluaran kebalikan dengan tanggal hari ini, supaya
 * net pengeluaran historical tetap correct di laporan saat itu.
 *
 * Pure function (no DB) — testable. Caller fetch shift summaries dulu lalu
 * pass ke sini.
 */

export interface ShiftSummaryForLockCheck {
  /** YYYY-MM-DD format (WIB). Sama dengan format expenseDate / incomeDate. */
  openedDateWib: string;
  status: "open" | "closed";
}

/**
 * Cek apakah ada shift closed yang openedDate-nya sama dengan targetDate.
 * Kalau iya, return shift pertama yang match (untuk diagnostic message).
 *
 * @param targetDate — YYYY-MM-DD (WIB) — tanggal expense/income yang
 *                     mau di-edit/delete.
 * @param shifts — list semua shift di outlet user yang relevan.
 *                 Caller harus filter outletId dulu.
 */
export function findClosedShiftBlockingDate(
  targetDate: string,
  shifts: ShiftSummaryForLockCheck[],
): ShiftSummaryForLockCheck | null {
  for (const s of shifts) {
    if (s.status === "closed" && s.openedDateWib === targetDate) {
      return s;
    }
  }
  return null;
}

/**
 * Bangun pesan error user-facing kalau lock kena. Kasih owner alternative
 * workflow: "bikin reversing entry" supaya tidak buntu.
 */
export function buildLockWindowErrorMessage(
  targetDate: string,
  entityLabel: "pengeluaran" | "pemasukan",
): string {
  return (
    `${entityLabel.charAt(0).toUpperCase()}${entityLabel.slice(1)} tanggal ${targetDate} ` +
    `sudah masuk laporan shift yang sudah ditutup. ` +
    `Edit/hapus akan bikin variance laporan jadi tidak sinkron dengan kas fisik. ` +
    `Untuk koreksi: bikin entry baru di Petty Cash dengan tanggal hari ini sebagai 'reversing entry' ` +
    `(${entityLabel} kebalikan).`
  );
}
