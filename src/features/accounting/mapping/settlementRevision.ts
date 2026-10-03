/**
 * Sesi AE-246 — REVISI SETTLEMENT per hari.
 *
 * Masalah nyata: angka settlement yang dihitung sistem (dari transaksi POS)
 * tidak selalu sama dengan uang yang benar-benar masuk ke rekening, dan
 * rekeningnya pun bisa berpindah-pindah — dalam satu bulan ada yang mendarat
 * di Mandiri, ada yang di BNI. Selisihnya biasanya biaya yang tidak terduga
 * (MDR berbeda, potongan admin), kadang justru lebih karena pembulatan.
 *
 * Revisi TIDAK mengubah jurnal settlement aslinya. Jurnal baru menukar apa
 * yang terlanjur dicatat dengan apa yang benar-benar terjadi:
 *
 *   Dr <rekening yang benar>    uang yang benar-benar masuk
 *   Dr 6402 Biaya MDR           selisih, kalau uang masuk LEBIH KECIL
 *      Cr <rekening tercatat>   nilai yang terlanjur dicatat
 *      Cr 6402 Biaya MDR        selisih, kalau uang masuk LEBIH BESAR
 *
 * Selisihnya jatuh ke 6402 karena memang itu sifatnya: potongan yang ternyata
 * beda dari perkiraan. Kalau uangnya lebih besar, 6402 dikredit — biayanya
 * berkurang, bukan jadi pendapatan baru yang mengembungkan omzet.
 *
 * Kalau rekeningnya SAMA dan cuma nilainya beda, barisnya diringkas jadi satu
 * pasang: mendebit sekaligus mengkredit rekening yang sama hanya menambah dua
 * baris yang saling meniadakan di Buku Besar.
 */

import type { JournalLineInput } from "../posting";

/** Akun biaya MDR — sama dengan yang dipakai jurnal settlement aslinya. */
export const ACCOUNT_MDR = "6402";

export interface SettlementRevisionInput {
  /** Nilai bersih yang terlanjur tercatat di jurnal settlement asli. */
  recordedAmount: number;
  /** Kode rekening yang terlanjur didebit jurnal asli. */
  recordedAccountCode: string;
  /** Uang yang benar-benar masuk menurut rekening koran. */
  actualAmount: number;
  /** Rekening yang benar-benar menerima uangnya. */
  actualAccountCode: string;
  /** Label untuk deskripsi, mis. "QRIS 2026-08-01". */
  label: string;
}

export function mapSettlementRevision(
  input: SettlementRevisionInput,
): JournalLineInput[] {
  const recorded = Math.floor(input.recordedAmount);
  const actual = Math.floor(input.actualAmount);
  if (recorded <= 0) throw new Error("MAP_SETTLEMENT_REVISION_RECORDED_NONPOSITIVE");
  if (actual < 0) throw new Error("MAP_SETTLEMENT_REVISION_ACTUAL_NEGATIVE");

  const sameAccount = input.recordedAccountCode === input.actualAccountCode;
  const diff = actual - recorded;

  if (sameAccount && diff === 0) {
    /* Tidak ada yang berubah. Ditolak, bukan menghasilkan jurnal kosong yang
     * cuma menambah baris tanpa arti di Buku Besar. */
    throw new Error("MAP_SETTLEMENT_REVISION_NO_CHANGE");
  }

  const lines: JournalLineInput[] = [];

  if (sameAccount) {
    /* Hanya nilainya yang berubah — cukup selisihnya yang dijurnal. */
    if (diff > 0) {
      lines.push({
        accountCode: input.actualAccountCode,
        debit: diff,
        description: `Revisi ${input.label}: uang masuk lebih besar dari catatan`,
      });
      lines.push({
        accountCode: ACCOUNT_MDR,
        credit: diff,
        description: `Potongan ternyata lebih kecil — ${input.label}`,
      });
    } else {
      lines.push({
        accountCode: ACCOUNT_MDR,
        debit: -diff,
        description: `Potongan ternyata lebih besar — ${input.label}`,
      });
      lines.push({
        accountCode: input.recordedAccountCode,
        credit: -diff,
        description: `Revisi ${input.label}: uang masuk lebih kecil dari catatan`,
      });
    }
    return lines;
  }

  /* Rekening berpindah: keluarkan seluruh nilai tercatat dari rekening lama,
   * masukkan yang benar-benar diterima ke rekening baru, selisihnya ke MDR. */
  if (actual > 0) {
    lines.push({
      accountCode: input.actualAccountCode,
      debit: actual,
      description: `Revisi ${input.label}: uang masuk ke rekening ini`,
    });
  }
  if (diff < 0) {
    lines.push({
      accountCode: ACCOUNT_MDR,
      debit: -diff,
      description: `Selisih settlement — ${input.label}`,
    });
  }
  lines.push({
    accountCode: input.recordedAccountCode,
    credit: recorded,
    description: `Koreksi: bukan ke rekening ini — ${input.label}`,
  });
  if (diff > 0) {
    lines.push({
      accountCode: ACCOUNT_MDR,
      credit: diff,
      description: `Potongan ternyata lebih kecil — ${input.label}`,
    });
  }
  return lines;
}

/** Pembalik: tukar sisi debit & kredit, keterangan diberi awalan. */
export function reverseSettlementRevisionLines(
  lines: JournalLineInput[],
): JournalLineInput[] {
  return lines.map((l) => ({
    accountCode: l.accountCode,
    debit: l.credit ?? 0,
    credit: l.debit ?? 0,
    description: `Pembalik: ${l.description ?? ""}`.trim(),
  }));
}
