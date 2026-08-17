/**
 * Sesi AE-204 — penyeimbang otomatis Entry Jurnal Manual.
 *
 * Arahan owner: "kalau input di debit, otomatis terinput nominal yang sama di
 * kreditnya, begitupun sebaliknya." Di jurnal dua baris itu berarti nominal
 * kembar di sisi berlawanan; di jurnal tiga baris atau lebih, artinya satu
 * baris menutup sisa selisihnya.
 *
 * Aturan yang dijaga fungsi ini:
 *  1. Angka yang DIKETIK manusia tidak pernah ditimpa. Hanya baris penanda
 *     (`autoLineId`) atau baris yang masih benar-benar kosong yang diisi.
 *  2. Begitu baris penanda itu sendiri diketik manual, penandanya dilepas —
 *     baris itu jadi milik pengguna.
 *  3. Sisi yang terkunci (akun Beban/HPP/Pendapatan non-kontra hanya boleh di
 *     sisi normalnya, lihat sesi AE-73) tidak pernah diisi paksa.
 *
 * Murni supaya bisa dites tanpa render modal.
 */

export interface BalanceLine {
  id: string;
  accountId: string | null;
  debit: string;
  credit: string;
}

export interface SideLocks {
  lockDebit: boolean;
  lockCredit: boolean;
}

export interface AutoBalanceResult<T extends BalanceLine> {
  lines: T[];
  autoLineId: string | null;
}

const NO_LOCKS: SideLocks = { lockDebit: false, lockCredit: false };

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Hitung ulang baris penyeimbang setelah `editedId` diubah nominalnya.
 *
 * @param lines      Baris SETELAH ketikan pengguna diterapkan (termasuk aturan
 *                   Dr-atau-Cr per baris).
 * @param editedId   Baris yang barusan diketik.
 * @param autoLineId Baris penyeimbang saat ini (null kalau belum ada).
 * @param locksOf    Resolver kunci sisi per akun.
 */
export function planAutoBalance<T extends BalanceLine>(
  lines: T[],
  editedId: string,
  autoLineId: string | null,
  locksOf: (accountId: string | null) => SideLocks = () => NO_LOCKS,
): AutoBalanceResult<T> {
  const editedWasAuto = autoLineId === editedId;

  /* Baris tujuan: penyeimbang lama kalau masih ada dan bukan yang diketik,
   * kalau tidak ada cari baris lain yang Dr & Cr-nya masih nol. */
  let targetId =
    !editedWasAuto && autoLineId != null && lines.some((l) => l.id === autoLineId)
      ? autoLineId
      : null;
  if (targetId == null) {
    targetId =
      lines.find(
        (l) => l.id !== editedId && num(l.debit) === 0 && num(l.credit) === 0,
      )?.id ?? null;
  }
  /* Semua baris lain sudah diisi manual — jangan sentuh apa pun. */
  if (targetId == null) {
    return { lines, autoLineId: editedWasAuto ? null : autoLineId };
  }

  /* Selisih baris SELAIN tujuan. Positif = kelebihan debit, jadi baris tujuan
   * yang menutup di kolom Credit. */
  let diff = 0;
  for (const l of lines) {
    if (l.id === targetId) continue;
    diff += num(l.debit) - num(l.credit);
  }

  const target = lines.find((l) => l.id === targetId)!;
  const locks = locksOf(target.accountId);
  if ((diff > 0 && locks.lockCredit) || (diff < 0 && locks.lockDebit)) {
    /* Akun tujuan terkunci di sisi yang dibutuhkan — biar pengguna yang
     * benahi, jangan paksa isi angka yang nanti ditolak validasi. */
    return { lines, autoLineId: editedWasAuto ? null : autoLineId };
  }

  return {
    lines: lines.map((l) =>
      l.id !== targetId
        ? l
        : {
            ...l,
            debit: diff < 0 ? String(Math.abs(diff)) : "0",
            credit: diff > 0 ? String(diff) : "0",
          },
    ),
    autoLineId: targetId,
  };
}
