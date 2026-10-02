/**
 * Sesi AE-242 — Mapping jurnal Belanja Daily Market.
 *
 * Top up (uang dikirim ke kurir, belum jadi biaya):
 *   Dr 1103 Saldo Kurir Daily Market   amount
 *      Cr <rekening bank asal>         amount
 *
 * Belanja (kurir memakai saldonya):
 *   Dr <akun beban kategori>           amount
 *      Cr 1103 Saldo Kurir             amount
 *
 * Jadi saldo 1103 = total top up − total belanja dengan sendirinya, dan
 * saldo bank ikut berkurang tepat saat uangnya ditransfer — bukan saat
 * barangnya dibeli.
 *
 * Reversal = tukar Dr/Cr dari template yang sama.
 */

import type { JournalLineInput } from "../posting";

export const ACCOUNT_SALDO_KURIR = "1103";

export interface DailyMarketTopupInput {
  amount: number;
  /** Kode COA rekening asal (hasil resolveBankCodeFromBankName). */
  bankAccountCode: string;
  bankLabel: string;
  courierName: string;
}

export function mapDailyMarketTopup(
  input: DailyMarketTopupInput,
): JournalLineInput[] {
  const amount = Math.floor(input.amount);
  if (amount <= 0) throw new Error("MAP_DAILY_MARKET_TOPUP_NONPOSITIVE");
  return [
    {
      accountCode: ACCOUNT_SALDO_KURIR,
      debit: amount,
      description: `Top up saldo belanja ${input.courierName}`,
    },
    {
      accountCode: input.bankAccountCode,
      credit: amount,
      description: `Transfer ke ${input.courierName} via ${input.bankLabel}`,
    },
  ];
}

export interface DailyMarketSpendInput {
  amount: number;
  /** Akun beban hasil resolusi kategori (prioritas sama dengan menu Kas). */
  expenseAccountCode: string;
  description: string;
  courierName: string;
}

export function mapDailyMarketSpend(
  input: DailyMarketSpendInput,
): JournalLineInput[] {
  const amount = Math.floor(input.amount);
  if (amount <= 0) throw new Error("MAP_DAILY_MARKET_SPEND_NONPOSITIVE");
  return [
    {
      accountCode: input.expenseAccountCode,
      debit: amount,
      description: input.description,
    },
    {
      accountCode: ACCOUNT_SALDO_KURIR,
      credit: amount,
      description: `Belanja oleh ${input.courierName}: ${input.description}`,
    },
  ];
}

/** Pembalik: tukar sisi debit & kredit, keterangan diberi awalan. */
export function reverseDailyMarketLines(
  lines: JournalLineInput[],
): JournalLineInput[] {
  return lines.map((l) => ({
    accountCode: l.accountCode,
    debit: l.credit ?? 0,
    credit: l.debit ?? 0,
    description: `Pembalik: ${l.description ?? ""}`.trim(),
  }));
}
