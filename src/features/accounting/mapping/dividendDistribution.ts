/**
 * Sesi AE-63c — Mapping helper untuk dividend distribution journal.
 *
 * Per Sheets owner Mahakan, semua dividen (investor + pengelola) di-debit
 * ke akun 3201 "Prive Owner" sebagai single bucket, credit ke kas/bank.
 *
 * Future: bisa di-split per-holder line atau pakai 32101/32102 separate
 * untuk detail trail, tapi Phase 1 simplifikasi.
 */

import type { JournalLineInput } from "../posting";

export interface DividendDistributionMappingInput {
  /** Total Bagi Hasil yang di-distribute (investor pool + pengelola pool +
   *  rounding residue yang masuk retained). */
  bagiHasilAmount: number;
  /** Note text untuk lines. */
  periodLabel: string; // mis. "Februari 2026"
}

/**
 * Build journal lines untuk distribution. Default:
 *   Dr 3201 Prive Owner   bagiHasil
 *     Cr 1101 Kas         bagiHasil
 *
 * Note: 3201 (kontra-equity, debit-normal) — total prive period jadi
 * pengurangan equity Owner. Kas keluar dari brankas/bank. Untuk
 * akumulasi balance investor/pengelola individu, trail di
 * profit_distribution_lines + capital_movements (di-link via
 * journalEntryId).
 */
export function mapDividendDistribution(
  input: DividendDistributionMappingInput,
): JournalLineInput[] {
  const amount = Math.max(0, Math.floor(input.bagiHasilAmount));
  return [
    {
      accountCode: "3201",
      debit: amount,
      credit: 0,
      description: `Dividen Bagi Hasil ${input.periodLabel}`,
    },
    {
      accountCode: "1101",
      debit: 0,
      credit: amount,
      description: `Pembayaran Dividen ${input.periodLabel}`,
    },
  ];
}
