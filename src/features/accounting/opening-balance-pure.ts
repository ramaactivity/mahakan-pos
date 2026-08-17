/**
 * Sesi AE-207 — logika murni "Ubah Saldo Awal" (tanpa DB, bisa dites).
 *
 * Owner mengetik NILAI RIIL per akun dalam angka positif ("kas Rp 12.000.000",
 * "hutang supplier Rp 3.000.000") dan tidak pernah memikirkan debit/kredit.
 * Modul ini yang menerjemahkannya ke baris jurnal yang seimbang.
 */

/** Kode akun penampung selisih. Bukan angka yang diketik owner. */
export const RETAINED_EARNINGS_CODE = "3301";

export type OpeningAccountInput = {
  accountId: string;
  code: string;
  /** "debit" | "credit" — arah normal akun (dari chart_of_accounts). */
  normalBalance: "debit" | "credit";
  /**
   * NILAI RIIL dalam arah NORMAL akun. Rupiah bulat.
   *
   * Boleh MINUS, dan itu bukan kasus teoretis: saldo produksi Mahakan per
   * 1 Juli punya `3101 Modal Owner` = −Rp11.700.000 (akun ber-arah kredit tapi
   * bersaldo debit, sisa jurnal konversi investor→kreditur). Kalau minus
   * ditolak, form ini bahkan tidak bisa menyimpan kembali kondisi yang sedang
   * berlaku. Nilai minus ditempatkan di sisi BERLAWANAN dari arah normalnya.
   */
  amount: number;
};

export type OpeningLine = {
  accountId: string;
  debit: number;
  credit: number;
  description: string;
};

export type BuildOpeningLinesResult = {
  lines: OpeningLine[];
  totalDebit: number;
  totalCredit: number;
  /** Nilai yang mendarat di 3301 (positif = debit, negatif = kredit). */
  retainedPlug: number;
};

export class OpeningBalanceError extends Error {}

/**
 * Susun baris jurnal Saldo Awal dari nilai riil yang diketik owner.
 *
 * Selisih antara total aset dan total kewajiban+modal SELALU dijatuhkan ke
 * 3301 Saldo Laba Ditahan. Itu memang tempatnya secara akuntansi: apa pun yang
 * tidak dijelaskan oleh aset/kewajiban/modal adalah akumulasi hasil usaha
 * periode-periode sebelumnya. Konsekuensinya entry ini TIDAK MUNGKIN tidak
 * seimbang — owner tidak bisa membuat neraca rusak lewat layar ini.
 *
 * @param retainedAccountId id akun 3301, wajib ada.
 */
export function buildOpeningBalanceLines(
  inputs: OpeningAccountInput[],
  retainedAccountId: string,
): BuildOpeningLinesResult {
  if (!retainedAccountId) {
    throw new OpeningBalanceError(
      `Akun ${RETAINED_EARNINGS_CODE} (Saldo Laba Ditahan) tidak ada di Bagan Akun — tidak bisa menghitung selisih.`,
    );
  }

  const seen = new Set<string>();
  const lines: OpeningLine[] = [];
  let totalDebit = 0;
  let totalCredit = 0;

  for (const a of inputs) {
    if (a.code === RETAINED_EARNINGS_CODE) {
      /* Dihitung sistem. Kalau ikut diketik, selisihnya jadi dobel dan
       * angkanya tidak akan pernah cocok dengan yang owner harapkan. */
      throw new OpeningBalanceError(
        `Akun ${RETAINED_EARNINGS_CODE} Saldo Laba Ditahan dihitung otomatis dari selisih, tidak bisa diisi manual.`,
      );
    }
    if (!Number.isFinite(a.amount) || !Number.isInteger(a.amount)) {
      throw new OpeningBalanceError(
        `Nilai akun ${a.code} harus angka bulat rupiah.`,
      );
    }
    if (seen.has(a.accountId)) {
      throw new OpeningBalanceError(`Akun ${a.code} terisi dua kali.`);
    }
    seen.add(a.accountId);

    if (a.amount === 0) continue; // nol tidak perlu baris

    /* Nilai minus mendarat di sisi BERLAWANAN dari arah normal akun. Dengan
     * begitu satu rumus menangani keduanya, dan angka yang dibaca ulang lewat
     * `linesToNaturalAmounts` persis sama dengan yang diketik. */
    const onNormalSide = a.amount > 0;
    const magnitude = Math.abs(a.amount);
    const putOnDebit =
      a.normalBalance === "debit" ? onNormalSide : !onNormalSide;

    if (putOnDebit) {
      totalDebit += magnitude;
      lines.push({
        accountId: a.accountId,
        debit: magnitude,
        credit: 0,
        description: `Saldo awal ${a.code}`,
      });
    } else {
      totalCredit += magnitude;
      lines.push({
        accountId: a.accountId,
        debit: 0,
        credit: magnitude,
        description: `Saldo awal ${a.code}`,
      });
    }
  }

  /* Plug: positif = 3301 di sisi DEBIT (akumulasi kerugian / aset lebih kecil
   * dari kewajiban+modal), negatif = sisi KREDIT (akumulasi laba). */
  const retainedPlug = totalCredit - totalDebit;
  if (retainedPlug !== 0) {
    lines.push({
      accountId: retainedAccountId,
      debit: retainedPlug > 0 ? retainedPlug : 0,
      credit: retainedPlug < 0 ? -retainedPlug : 0,
      description: `Selisih ke Saldo Laba Ditahan`,
    });
  }

  if (lines.length < 2) {
    throw new OpeningBalanceError(
      "Saldo awal butuh minimal 2 akun bernilai. Isi dulu kas/bank dan lawannya.",
    );
  }

  const finalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const finalCredit = lines.reduce((s, l) => s + l.credit, 0);
  /* Sanity terakhir — kalau ini pernah kepicu, ada bug di atas, JANGAN
   * biarkan jurnal tak seimbang masuk buku. */
  if (finalDebit !== finalCredit) {
    throw new OpeningBalanceError(
      `Jurnal tidak seimbang (debit ${finalDebit} vs kredit ${finalCredit}). Laporkan ini sebagai bug.`,
    );
  }

  return {
    lines,
    totalDebit: finalDebit,
    totalCredit: finalCredit,
    retainedPlug,
  };
}

/**
 * Ubah baris jurnal yang tersimpan kembali menjadi "nilai riil" per akun,
 * untuk ditampilkan di form. Kebalikan dari `buildOpeningBalanceLines`.
 */
export function linesToNaturalAmounts(
  lines: Array<{
    accountId: string;
    debit: number | string;
    credit: number | string;
    normalBalance: "debit" | "credit";
  }>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines) {
    const debit = Number(l.debit) || 0;
    const credit = Number(l.credit) || 0;
    const natural = l.normalBalance === "debit" ? debit - credit : credit - debit;
    out.set(l.accountId, (out.get(l.accountId) ?? 0) + natural);
  }
  return out;
}
