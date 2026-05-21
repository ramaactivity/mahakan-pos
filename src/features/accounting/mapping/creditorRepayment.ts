/**
 * Sesi AE-80 — Mapping helper untuk creditor repayment journal.
 *
 * Repayment cicilan ke kreditur dengan split pokok + bunga:
 *   Dr 2150 Hutang Kreditur    principalAmount  (cicilan pokok)
 *   Dr 5301 Beban Bunga Kreditur interestAmount   (skip kalau 0)
 *      Cr <bank account>       principalAmount + interestAmount  (kas keluar)
 *
 * Reversal: swap Dr/Cr.
 *   Dr <bank account>          total      (kas balik)
 *      Cr 2150 Hutang Kreditur principal  (restore liability)
 *      Cr 5301 Beban Bunga     interest   (skip kalau 0)
 *
 * Bank account code di-resolve di caller.
 */

import type { JournalLineInput } from "../posting";

const ACCOUNT_HUTANG_KREDITUR = "2150";
const ACCOUNT_BEBAN_BUNGA = "6701";

export interface CreditorRepaymentMappingInput {
  /** Pokok cicilan (Rupiah). Min 0, total > 0. */
  principalAmount: number;
  /** Bunga periode ini (Rupiah). Bisa 0. */
  interestAmount: number;
  /** Pre-resolved bank COA code. */
  bankAccountCode: string;
  /** Display label untuk description. */
  bankDestinationLabel: string;
  /** Creditor name untuk audit trail. */
  creditorName: string;
}

export function mapCreditorRepayment(
  input: CreditorRepaymentMappingInput,
): JournalLineInput[] {
  const principal = Math.max(0, Math.floor(input.principalAmount));
  const interest = Math.max(0, Math.floor(input.interestAmount));
  const total = principal + interest;
  if (total <= 0) {
    throw new Error("MAP_CREDITOR_REPAYMENT_ZERO_TOTAL");
  }
  const lines: JournalLineInput[] = [];
  if (principal > 0) {
    lines.push({
      accountCode: ACCOUNT_HUTANG_KREDITUR,
      debit: principal,
      description: `Cicilan pokok ke ${input.creditorName}`,
    });
  }
  if (interest > 0) {
    lines.push({
      accountCode: ACCOUNT_BEBAN_BUNGA,
      debit: interest,
      description: `Beban bunga ${input.creditorName}`,
    });
  }
  lines.push({
    accountCode: input.bankAccountCode,
    credit: total,
    description: `Transfer cicilan ke ${input.bankDestinationLabel}`,
  });
  return lines;
}

export function mapCreditorRepaymentReversal(
  input: CreditorRepaymentMappingInput & { reason: string },
): JournalLineInput[] {
  const principal = Math.max(0, Math.floor(input.principalAmount));
  const interest = Math.max(0, Math.floor(input.interestAmount));
  const total = principal + interest;
  if (total <= 0) {
    throw new Error("MAP_CREDITOR_REPAYMENT_REVERSAL_ZERO_TOTAL");
  }
  const reasonShort = input.reason.slice(0, 100);
  const lines: JournalLineInput[] = [
    {
      accountCode: input.bankAccountCode,
      debit: total,
      description: `Reversal cicilan dari ${input.bankDestinationLabel}: ${reasonShort}`,
    },
  ];
  if (principal > 0) {
    lines.push({
      accountCode: ACCOUNT_HUTANG_KREDITUR,
      credit: principal,
      description: `Restore hutang pokok ${input.creditorName}: ${reasonShort}`,
    });
  }
  if (interest > 0) {
    lines.push({
      accountCode: ACCOUNT_BEBAN_BUNGA,
      credit: interest,
      description: `Reversal beban bunga ${input.creditorName}: ${reasonShort}`,
    });
  }
  return lines;
}
