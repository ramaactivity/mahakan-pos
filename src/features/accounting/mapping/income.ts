/**
 * mapIncomeCreate — non-POS income → journal lines.
 *
 * Per design doc §4.13. Income (event rental, titip jual, dll) entered di
 * Admin → Kas → Tambah Pemasukan.
 *
 * Mapping:
 *   Dr 1101 Kas / 1110 Bank          income.amount
 *      Cr 4201 Pendapatan Lain-lain   income.amount
 */

import type { JournalLineInput } from "../posting";

export type IncomePaymentMethod = "cash" | "transfer" | "other";

export type IncomeCreateInput = {
  incomeId: string;
  outletId: string;
  entryDate: string;
  amount: number;
  description: string;
  paymentMethod: IncomePaymentMethod;
  /** Sesi AE-69 — kalau staff pilih bank account specific, override Dr
   * side code. Caller resolve dari bank_accounts.bankName. */
  cashBankCodeOverride?: string | null;
  /** Sesi AE-71 — kalau owner pilih akun pendapatan specific, override
   * Cr side code. Caller resolve dari chart_of_accounts.code. NULL =
   * default 4201 Pendapatan Lain-lain. */
  revenueAccountCodeOverride?: string | null;
};

/** Nama metode terima uang buat deskripsi jurnal — jangan tulis enum mentah. */
export function incomePaymentLabel(method: IncomePaymentMethod): string {
  switch (method) {
    case "cash":
      return "tunai";
    case "transfer":
      return "transfer bank";
    case "other":
      return "bank lain";
  }
}

export function incomeCashBankCode(method: IncomePaymentMethod): string {
  switch (method) {
    case "cash":
      return "1101";
    case "transfer":
      return "1110";
    case "other":
      return "1112";
  }
}

export function mapIncomeCreate(input: IncomeCreateInput): JournalLineInput[] {
  if (input.amount <= 0) {
    throw new Error("MAP_INCOME_NONPOSITIVE");
  }

  const cashBankCode =
    input.cashBankCodeOverride ?? incomeCashBankCode(input.paymentMethod);
  const revenueCode = input.revenueAccountCodeOverride ?? "4201";

  return [
    {
      accountCode: cashBankCode,
      debit: input.amount,
      description: `Uang masuk ${incomePaymentLabel(input.paymentMethod)} — ${input.description}`,
    },
    {
      accountCode: revenueCode,
      credit: input.amount,
      description: input.description,
    },
  ];
}
