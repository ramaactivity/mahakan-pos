/**
 * Sesi AE-214 — REVALUASI & PENURUNAN NILAI (impairment) aset tetap.
 *
 * Tiga peristiwa, tiga perlakuan yang sengaja dibedakan — bukan tiga nama
 * untuk hal yang sama:
 *
 *   Revaluasi            : nilai tercatat disesuaikan ke nilai wajar terkini.
 *                          KENAIKAN tidak masuk laba rugi, melainkan ekuitas
 *                          (3501 Surplus Revaluasi) — labanya belum terwujud,
 *                          asetnya belum dijual. PENURUNAN dibebankan dulu ke
 *                          surplus revaluasi aset yang sama sampai habis, sisanya
 *                          baru jadi rugi di laba rugi. (PSAK 16 par. 39-40)
 *   Penurunan Nilai      : nilai tercatat melebihi nilai yang benar-benar bisa
 *                          dipulihkan (mesin rusak, jarang dipakai, harga jatuh).
 *                          Selisihnya LANGSUNG jadi rugi. (PSAK 48)
 *   Pemulihan Penurunan  : keadaan yang dulu bikin turun sudah membaik. Diakui
 *                          sebagai pendapatan, DIBATASI sebesar rugi penurunan
 *                          nilai yang pernah diakui untuk aset itu — pemulihan
 *                          tidak boleh berubah jadi keuntungan revaluasi lewat
 *                          pintu belakang.
 *
 * BATAS YANG BELUM DITEGAKKAN (disebutkan supaya tidak dikira sudah beres):
 * PSAK 48 par. 117 memberi SATU batas lagi untuk pemulihan — nilai tercatat
 * sesudah pemulihan tidak boleh melebihi nilai tercatat seandainya aset itu
 * tidak pernah turun nilai. Menghitungnya butuh jadwal penyusutan bayangan
 * (versi "tanpa penurunan nilai") yang dipelihara sepanjang umur aset. Di sini
 * baru batas pertama yang ditegakkan: sebesar akumulasi penurunan nilai yang
 * masih menempel. Untuk aset yang dipulihkan tak lama setelah diturunkan,
 * keduanya praktis sama; selisihnya baru berarti kalau pemulihan terjadi
 * bertahun-tahun kemudian.
 *
 * Metode revaluasi yang dipakai: ELIMINASI (PSAK 16 par. 35(b)). Akumulasi
 * penyusutan (dan akumulasi penurunan nilai) aset itu dihapus dulu ke nilai
 * bruto, lalu nilai brutonya ditulis ulang sebesar nilai wajar. Alternatifnya
 * (proporsional/gross-up) menghasilkan neraca yang sama tapi menyisakan angka
 * bruto & akumulasi yang tidak lagi punya arti fisik bagi owner — "harga
 * perolehan" yang bukan harga yang pernah dibayar siapa pun. Harga perolehan
 * asli tetap tersimpan di kolom `cost` untuk jejak.
 *
 * File ini bagian murninya: menghitung alokasi + baris jurnal + keadaan aset
 * sesudahnya. Tidak menyentuh DB supaya bisa dites.
 */

export type ValuationKind =
  | "revaluation"
  | "impairment"
  | "impairment_reversal";

export const VALUATION_KINDS: Array<{
  value: ValuationKind;
  label: string;
  help: string;
}> = [
  {
    value: "revaluation",
    label: "Revaluasi (nilai wajar)",
    help: "Nilai aset dinilai ulang ke harga wajar sekarang — boleh naik boleh turun. Kenaikan masuk ekuitas (Surplus Revaluasi), bukan laba.",
  },
  {
    value: "impairment",
    label: "Penurunan Nilai (impairment)",
    help: "Aset rusak / jarang dipakai / harganya jatuh sehingga nilainya tidak lagi bisa dipulihkan sebesar nilai tercatat. Selisihnya langsung jadi rugi.",
  },
  {
    value: "impairment_reversal",
    label: "Pemulihan Penurunan Nilai",
    help: "Keadaan yang dulu membuat nilainya turun sudah membaik. Dibatasi sebesar penurunan yang pernah diakui.",
  },
];

/* Akun-akun yang dipakai. Kelimanya dibuat migrasi 0097 per outlet dan baru
 * diaktifkan saat modul aset tetap benar-benar dipakai. */
export const ACC_ACCUM_IMPAIRMENT = "1291";
export const ACC_REVALUATION_SURPLUS = "3501";
export const ACC_IMPAIRMENT_RECOVERY = "4204";
export const ACC_IMPAIRMENT_LOSS = "6505";
export const ACC_REVALUATION_LOSS = "6506";

export const VALUATION_ACCOUNT_CODES = [
  ACC_ACCUM_IMPAIRMENT,
  ACC_REVALUATION_SURPLUS,
  ACC_IMPAIRMENT_RECOVERY,
  ACC_IMPAIRMENT_LOSS,
  ACC_REVALUATION_LOSS,
];

export type ValuationLine = {
  accountCode: string;
  debit?: number;
  credit?: number;
  description: string;
};

export type AssetValuationState = {
  assetName: string;
  assetAccountCode: string;
  accumulatedDepreciationAccountCode: string;
  /** Nilai bruto aset yang tercatat di buku besar (bukan harga perolehan historis). */
  grossAmount: number;
  /** Akumulasi penyusutan aset ini yang tercatat di 1290. */
  accumulatedDepreciation: number;
  /** Akumulasi penurunan nilai aset ini yang tercatat di 1291. */
  accumulatedImpairment: number;
  /** Saldo surplus revaluasi (3501) milik aset ini. */
  revaluationSurplus: number;
  /** Rugi revaluasi aset ini yang pernah dibebankan ke laba rugi (6506). */
  revaluationLossRecognized: number;
  /** Nilai sisa — dipakai memperingatkan kalau nilai barunya di bawah ini. */
  salvageValue: number;
};

export type ValuationRequest = {
  kind: ValuationKind;
  /** Nilai tercatat yang DIINGINKAN sesudah peristiwa ini (rupiah bulat). */
  newCarrying: number;
  /** Sisa umur manfaat (bulan) terhitung sejak basis baru berlaku. */
  remainingLifeMonths: number;
};

export type AssetValuationNextState = {
  grossAmount: number;
  /** Akumulasi penyusutan yang MASIH tercatat sesudah peristiwa (0 kalau dieliminasi). */
  accumulatedDepreciation: number;
  accumulatedImpairment: number;
  revaluationSurplus: number;
  revaluationLossRecognized: number;
  basisAmount: number;
  basisRemainingMonths: number;
};

export type ValuationPlan = {
  ok: boolean;
  /** Alasan kenapa tidak bisa diposting — ditampilkan apa adanya ke owner. */
  errors: string[];
  warnings: string[];
  carryingBefore: number;
  carryingAfter: number;
  /** carryingAfter − carryingBefore. Negatif = nilainya turun. */
  delta: number;
  accumDepEliminated: number;
  accumImpairmentEliminated: number;
  /** Kenaikan yang masuk ekuitas (Cr 3501). */
  surplusCredit: number;
  /** Penurunan yang menggerus surplus lebih dulu (Dr 3501). */
  surplusDebit: number;
  /** Yang masuk laba rugi sebagai pendapatan (Cr 4204). */
  plGain: number;
  /** Yang masuk laba rugi sebagai rugi (Dr 6505 / 6506). */
  plLoss: number;
  /** Perubahan saldo akumulasi penurunan nilai (+ menambah, − memulihkan). */
  impairmentDelta: number;
  lines: ValuationLine[];
  nextState: AssetValuationNextState | null;
};

export function carryingAmountOf(state: {
  grossAmount: number;
  accumulatedDepreciation: number;
  accumulatedImpairment: number;
}): number {
  return (
    state.grossAmount - state.accumulatedDepreciation - state.accumulatedImpairment
  );
}

function emptyPlan(
  carryingBefore: number,
  errors: string[],
): ValuationPlan {
  return {
    ok: false,
    errors,
    warnings: [],
    carryingBefore,
    carryingAfter: carryingBefore,
    delta: 0,
    accumDepEliminated: 0,
    accumImpairmentEliminated: 0,
    surplusCredit: 0,
    surplusDebit: 0,
    plGain: 0,
    plLoss: 0,
    impairmentDelta: 0,
    lines: [],
    nextState: null,
  };
}

/**
 * Hitung alokasi + jurnal + keadaan sesudahnya.
 *
 * Selalu mengembalikan objek (tidak melempar) supaya layar pratinjau bisa
 * menampilkan alasannya, bukan cuma gagal.
 */
export function planAssetValuation(
  state: AssetValuationState,
  req: ValuationRequest,
): ValuationPlan {
  const carryingBefore = carryingAmountOf(state);
  const errors: string[] = [];
  const warnings: string[] = [];

  const newCarrying = Math.round(req.newCarrying);
  if (!Number.isFinite(newCarrying) || newCarrying < 0) {
    errors.push("Nilai barunya harus angka ≥ 0.");
  }
  if (
    !Number.isFinite(req.remainingLifeMonths) ||
    req.remainingLifeMonths < 1 ||
    req.remainingLifeMonths > 600
  ) {
    errors.push("Sisa umur manfaat harus 1-600 bulan.");
  }
  if (carryingBefore < 0) {
    errors.push(
      "Nilai tercatat aset ini sudah minus — perbaiki dulu datanya sebelum dinilai ulang.",
    );
  }
  if (errors.length > 0) return emptyPlan(carryingBefore, errors);

  const delta = newCarrying - carryingBefore;

  if (req.kind === "impairment" && delta >= 0) {
    return emptyPlan(carryingBefore, [
      "Penurunan nilai berarti nilai barunya harus LEBIH KECIL dari nilai tercatat sekarang. Kalau nilainya naik, pakai Revaluasi atau Pemulihan Penurunan Nilai.",
    ]);
  }
  if (req.kind === "impairment_reversal") {
    if (delta <= 0) {
      return emptyPlan(carryingBefore, [
        "Pemulihan berarti nilai barunya harus LEBIH BESAR dari nilai tercatat sekarang.",
      ]);
    }
    if (state.accumulatedImpairment <= 0) {
      return emptyPlan(carryingBefore, [
        "Aset ini belum pernah diturunkan nilainya, jadi tidak ada yang bisa dipulihkan. Pakai Revaluasi kalau memang mau menaikkan nilainya.",
      ]);
    }
    if (delta > state.accumulatedImpairment) {
      return emptyPlan(carryingBefore, [
        `Pemulihan maksimal sebesar penurunan yang pernah diakui: Rp ${state.accumulatedImpairment.toLocaleString("id-ID")}. Selebihnya harus lewat Revaluasi.`,
      ]);
    }
  }
  if (req.kind === "revaluation" && delta === 0) {
    return emptyPlan(carryingBefore, [
      "Nilai barunya sama dengan nilai tercatat sekarang — tidak ada yang perlu dijurnal.",
    ]);
  }

  const lines: ValuationLine[] = [];
  let accumDepEliminated = 0;
  let accumImpairmentEliminated = 0;
  let surplusCredit = 0;
  let surplusDebit = 0;
  let plGain = 0;
  let plLoss = 0;
  let impairmentDelta = 0;

  const next: AssetValuationNextState = {
    grossAmount: state.grossAmount,
    accumulatedDepreciation: state.accumulatedDepreciation,
    accumulatedImpairment: state.accumulatedImpairment,
    revaluationSurplus: state.revaluationSurplus,
    revaluationLossRecognized: state.revaluationLossRecognized,
    basisAmount: newCarrying,
    basisRemainingMonths: Math.round(req.remainingLifeMonths),
  };

  if (req.kind === "revaluation") {
    /* Langkah 1 — eliminasi akumulasi terhadap nilai bruto. Sesudah ini nilai
     * bruto di buku = nilai tercatat, dan kontra-akunnya nol untuk aset ini. */
    accumDepEliminated = state.accumulatedDepreciation;
    accumImpairmentEliminated = state.accumulatedImpairment;
    const eliminated = accumDepEliminated + accumImpairmentEliminated;
    if (eliminated > 0) {
      if (accumDepEliminated > 0) {
        lines.push({
          accountCode: state.accumulatedDepreciationAccountCode,
          debit: accumDepEliminated,
          description: `Eliminasi akumulasi penyusutan — revaluasi ${state.assetName}`,
        });
      }
      if (accumImpairmentEliminated > 0) {
        lines.push({
          accountCode: ACC_ACCUM_IMPAIRMENT,
          debit: accumImpairmentEliminated,
          description: `Eliminasi akumulasi penurunan nilai — revaluasi ${state.assetName}`,
        });
      }
      lines.push({
        accountCode: state.assetAccountCode,
        credit: eliminated,
        description: `Nilai bruto disetel ke nilai tercatat — revaluasi ${state.assetName}`,
      });
    }

    /* Langkah 2 — selisih revaluasinya sendiri. */
    if (delta > 0) {
      plGain = Math.min(delta, state.revaluationLossRecognized);
      surplusCredit = delta - plGain;
      lines.push({
        accountCode: state.assetAccountCode,
        debit: delta,
        description: `Kenaikan nilai revaluasi ${state.assetName}`,
      });
      if (plGain > 0) {
        lines.push({
          accountCode: ACC_IMPAIRMENT_RECOVERY,
          credit: plGain,
          description: `Pemulihan rugi revaluasi yang pernah dibebankan — ${state.assetName}`,
        });
      }
      if (surplusCredit > 0) {
        lines.push({
          accountCode: ACC_REVALUATION_SURPLUS,
          credit: surplusCredit,
          description: `Surplus revaluasi ${state.assetName}`,
        });
      }
      next.revaluationLossRecognized -= plGain;
      next.revaluationSurplus += surplusCredit;
    } else {
      const d = -delta;
      surplusDebit = Math.min(d, state.revaluationSurplus);
      plLoss = d - surplusDebit;
      if (surplusDebit > 0) {
        lines.push({
          accountCode: ACC_REVALUATION_SURPLUS,
          debit: surplusDebit,
          description: `Surplus revaluasi terpakai — penurunan nilai revaluasi ${state.assetName}`,
        });
      }
      if (plLoss > 0) {
        lines.push({
          accountCode: ACC_REVALUATION_LOSS,
          debit: plLoss,
          description: `Rugi revaluasi ${state.assetName}`,
        });
      }
      lines.push({
        accountCode: state.assetAccountCode,
        credit: d,
        description: `Penurunan nilai revaluasi ${state.assetName}`,
      });
      next.revaluationSurplus -= surplusDebit;
      next.revaluationLossRecognized += plLoss;
    }

    next.grossAmount = newCarrying;
    next.accumulatedDepreciation = 0;
    next.accumulatedImpairment = 0;

    if (state.revaluationSurplus > 0 && delta < 0 && plLoss > 0) {
      warnings.push(
        `Surplus revaluasi aset ini (Rp ${state.revaluationSurplus.toLocaleString("id-ID")}) terpakai habis lebih dulu; sisanya Rp ${plLoss.toLocaleString("id-ID")} jadi rugi di laba rugi.`,
      );
    }
    warnings.push(
      "Model revaluasi berlaku untuk SATU KELAS aset, bukan satu unit. Kalau mesin dapur ini direvaluasi, mesin dapur lain semestinya ikut dinilai ulang pada tanggal yang sama.",
    );
  } else if (req.kind === "impairment") {
    plLoss = -delta;
    impairmentDelta = plLoss;
    lines.push({
      accountCode: ACC_IMPAIRMENT_LOSS,
      debit: plLoss,
      description: `Rugi penurunan nilai ${state.assetName}`,
    });
    lines.push({
      accountCode: ACC_ACCUM_IMPAIRMENT,
      credit: plLoss,
      description: `Akumulasi penurunan nilai ${state.assetName}`,
    });
    next.accumulatedImpairment += plLoss;
  } else {
    plGain = delta;
    impairmentDelta = -delta;
    lines.push({
      accountCode: ACC_ACCUM_IMPAIRMENT,
      debit: plGain,
      description: `Pemulihan akumulasi penurunan nilai ${state.assetName}`,
    });
    lines.push({
      accountCode: ACC_IMPAIRMENT_RECOVERY,
      credit: plGain,
      description: `Pemulihan rugi penurunan nilai ${state.assetName}`,
    });
    next.accumulatedImpairment -= plGain;
  }

  /* Jaring pengaman: kalau jurnalnya tidak seimbang, jangan pernah sampai ke
   * `recordJournal` — di sana kegagalannya muncul sebagai error teknis yang
   * tidak bisa dibaca owner. */
  const totalDebit = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
  if (totalDebit !== totalCredit) {
    return emptyPlan(carryingBefore, [
      `Jurnalnya tidak seimbang (debit Rp ${totalDebit.toLocaleString("id-ID")} vs kredit Rp ${totalCredit.toLocaleString("id-ID")}) — jangan diposting, laporkan ke dev.`,
    ]);
  }
  if (lines.length < 2) {
    return emptyPlan(carryingBefore, [
      "Tidak ada baris jurnal yang terbentuk — tidak ada yang perlu dicatat.",
    ]);
  }

  if (newCarrying <= 0) {
    warnings.push(
      "Nilai barunya nol — asetnya masih terdaftar tapi tidak akan disusutkan lagi. Kalau asetnya memang sudah dilepas, hapus dari daftar setelah ini.",
    );
  }
  if (newCarrying > 0 && newCarrying <= state.salvageValue) {
    warnings.push(
      `Nilai barunya (Rp ${newCarrying.toLocaleString("id-ID")}) tidak melebihi nilai sisa (Rp ${state.salvageValue.toLocaleString("id-ID")}), jadi aset ini berhenti disusutkan mulai basis baru.`,
    );
  }

  return {
    ok: true,
    errors: [],
    warnings,
    carryingBefore,
    carryingAfter: newCarrying,
    delta,
    accumDepEliminated,
    accumImpairmentEliminated,
    surplusCredit,
    surplusDebit,
    plGain,
    plLoss,
    impairmentDelta,
    lines,
    nextState: next,
  };
}
