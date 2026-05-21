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

/**
 * Sesi AE-80 — Waterfall V2 mapping.
 *
 * V2 model re-classify equity → liability saat approve distribution:
 *   Dr 3201 Prive Owner       bagiHasil
 *     Cr 2160 Hutang Dividen   bagiHasil
 *
 * Bedanya dengan V1: tidak langsung Cr Kas. Saldo dividen "menggantung"
 * di akun liability 2160 sampai investor melakukan withdrawal — saat
 * withdrawal, baru Dr 2160 / Cr Kas (lihat mapping/dividendWithdrawal.ts).
 *
 * Retained earnings TIDAK dijurnal — sisa otomatis tetap di equity
 * (3301 Saldo Laba Ditahan tidak terpengaruh oleh distribusi v2 ini;
 * yang berkurang adalah Prive Owner via 3201).
 */
export function mapDividendDistributionV2(
  input: DividendDistributionMappingInput,
): JournalLineInput[] {
  const amount = Math.max(0, Math.floor(input.bagiHasilAmount));
  return [
    {
      accountCode: "3201",
      debit: amount,
      credit: 0,
      description: `Dividen Bagi Hasil ${input.periodLabel} (v2 accrual)`,
    },
    {
      accountCode: "2160",
      debit: 0,
      credit: amount,
      description: `Hutang Dividen ${input.periodLabel}`,
    },
  ];
}

/**
 * Sesi AE-80 — Reversal mapping. Mirror v2 dengan Dr↔Cr swap.
 *
 * Saat reverseDistribution dipanggil:
 *   Dr 2160 Hutang Dividen     bagiHasil  (cancel liability)
 *     Cr 3201 Prive Owner       bagiHasil  (restore equity)
 */
export function mapDividendDistributionReversal(
  input: DividendDistributionMappingInput,
): JournalLineInput[] {
  const amount = Math.max(0, Math.floor(input.bagiHasilAmount));
  return [
    {
      accountCode: "2160",
      debit: amount,
      credit: 0,
      description: `Pembatalan Hutang Dividen ${input.periodLabel}`,
    },
    {
      accountCode: "3201",
      debit: 0,
      credit: amount,
      description: `Reversal Prive Owner ${input.periodLabel}`,
    },
  ];
}
