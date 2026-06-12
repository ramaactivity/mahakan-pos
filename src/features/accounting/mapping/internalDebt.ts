/**
 * Sesi AE-180 — Mapping helper untuk Hutang Internal (Talangan).
 *
 * Entry talangan biaya (kind='expense_advance' — owner bayar pengeluaran
 * pakai uang pribadi, kas bisnis TIDAK keluar):
 *   Dr <akun beban kategori>     amount
 *      Cr 2170 Hutang Internal   amount
 *
 * Entry pinjaman tunai (kind='cash_loan' — uang pribadi masuk rekening
 * bisnis):
 *   Dr <bank account>            amount
 *      Cr 2170 Hutang Internal   amount
 *
 * Cicilan (repayment — bisnis bayar balik):
 *   Dr 2170 Hutang Internal      amount
 *      Cr <bank account>         amount
 *
 * Reversal: swap Dr/Cr dari masing-masing template.
 */

import type { JournalLineInput } from "../posting";

export const ACCOUNT_HUTANG_INTERNAL = "2170";

export interface InternalDebtExpenseMappingInput {
  /** Nominal talangan (Rupiah). */
  amount: number;
  /** Pre-resolved akun beban (priority accountId → category default → 6901). */
  expenseAccountCode: string;
  /** Deskripsi biaya. */
  description: string;
  /** Nama pihak yang nalangin. */
  partyName: string;
}

export function mapInternalDebtExpense(
  input: InternalDebtExpenseMappingInput,
): JournalLineInput[] {
  const amount = Math.floor(input.amount);
  if (amount <= 0) {
    throw new Error("MAP_INTERNAL_DEBT_EXPENSE_NONPOSITIVE");
  }
  return [
    {
      accountCode: input.expenseAccountCode,
      debit: amount,
      description: input.description,
    },
    {
      accountCode: ACCOUNT_HUTANG_INTERNAL,
      credit: amount,
      description: `Talangan oleh ${input.partyName}: ${input.description}`,
    },
  ];
}

export interface InternalDebtLoanMappingInput {
  /** Nominal pinjaman tunai masuk (Rupiah). */
  amount: number;
  /** Pre-resolved bank COA code (rekening bisnis penerima). */
  bankAccountCode: string;
  /** Display label bank untuk description. */
  bankLabel: string;
  /** Nama pihak yang minjamin. */
  partyName: string;
}

export function mapInternalDebtLoan(
  input: InternalDebtLoanMappingInput,
): JournalLineInput[] {
  const amount = Math.floor(input.amount);
  if (amount <= 0) {
    throw new Error("MAP_INTERNAL_DEBT_LOAN_NONPOSITIVE");
  }
  return [
    {
      accountCode: input.bankAccountCode,
      debit: amount,
      description: `Pinjaman tunai dari ${input.partyName} masuk ${input.bankLabel}`,
    },
    {
      accountCode: ACCOUNT_HUTANG_INTERNAL,
      credit: amount,
      description: `Hutang internal ke ${input.partyName}`,
    },
  ];
}

/**
 * Reversal entry — swap Dr/Cr. `counterAccountCode` = akun lawan dari
 * 2170 pada entry original (akun beban untuk expense_advance, bank untuk
 * cash_loan).
 */
export function mapInternalDebtEntryReversal(input: {
  amount: number;
  counterAccountCode: string;
  partyName: string;
  reason: string;
}): JournalLineInput[] {
  const amount = Math.floor(input.amount);
  if (amount <= 0) {
    throw new Error("MAP_INTERNAL_DEBT_ENTRY_REVERSAL_NONPOSITIVE");
  }
  const reasonShort = input.reason.slice(0, 100);
  return [
    {
      accountCode: ACCOUNT_HUTANG_INTERNAL,
      debit: amount,
      description: `Reversal hutang internal ${input.partyName}: ${reasonShort}`,
    },
    {
      accountCode: input.counterAccountCode,
      credit: amount,
      description: `Reversal entry talangan ${input.partyName}: ${reasonShort}`,
    },
  ];
}

export interface InternalDebtRepaymentMappingInput {
  /** Nominal cicilan (Rupiah). */
  amount: number;
  /** Pre-resolved bank COA code (rekening bisnis sumber). */
  bankAccountCode: string;
  /** Display label bank untuk description. */
  bankLabel: string;
  /** Nama pihak yang dibayar. */
  partyName: string;
}

export function mapInternalDebtRepayment(
  input: InternalDebtRepaymentMappingInput,
): JournalLineInput[] {
  const amount = Math.floor(input.amount);
  if (amount <= 0) {
    throw new Error("MAP_INTERNAL_DEBT_REPAYMENT_NONPOSITIVE");
  }
  return [
    {
      accountCode: ACCOUNT_HUTANG_INTERNAL,
      debit: amount,
      description: `Cicilan hutang internal ke ${input.partyName}`,
    },
    {
      accountCode: input.bankAccountCode,
      credit: amount,
      description: `Transfer cicilan ke ${input.partyName} via ${input.bankLabel}`,
    },
  ];
}

export function mapInternalDebtRepaymentReversal(
  input: InternalDebtRepaymentMappingInput & { reason: string },
): JournalLineInput[] {
  const amount = Math.floor(input.amount);
  if (amount <= 0) {
    throw new Error("MAP_INTERNAL_DEBT_REPAYMENT_REVERSAL_NONPOSITIVE");
  }
  const reasonShort = input.reason.slice(0, 100);
  return [
    {
      accountCode: input.bankAccountCode,
      debit: amount,
      description: `Reversal cicilan dari ${input.bankLabel}: ${reasonShort}`,
    },
    {
      accountCode: ACCOUNT_HUTANG_INTERNAL,
      credit: amount,
      description: `Restore hutang internal ${input.partyName}: ${reasonShort}`,
    },
  ];
}
