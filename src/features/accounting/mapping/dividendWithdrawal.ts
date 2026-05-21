/**
 * Sesi AE-80 — Mapping helper untuk dividend withdrawal journal.
 *
 * Saat investor tarik saldo dividen (V2 flow):
 *   Dr 3202 Hutang Dividen     withdraw.amount  (cancel liability)
 *      Cr <bank account>       withdraw.amount  (kas keluar)
 *
 * Bank account code di-resolve di caller via lookup bank_accounts (sama
 * pattern dengan cashDeposit). Caller pass pre-resolved code.
 *
 * Reversal: swap Dr/Cr — Dr Bank / Cr 3202 (restore liability).
 */

import type { JournalLineInput } from "../posting";

export interface DividendWithdrawalMappingInput {
  /** Amount withdrawal (Rupiah). */
  amount: number;
  /** Pre-resolved bank account COA code (1110/1111/1112/dll). */
  bankAccountCode: string;
  /** Display label untuk description journal (mis. "BCA Anisa ...2515"). */
  bankDestinationLabel: string;
  /** Investor name untuk audit trail. */
  investorName: string;
}

export function mapDividendWithdrawal(
  input: DividendWithdrawalMappingInput,
): JournalLineInput[] {
  if (input.amount <= 0) {
    throw new Error("MAP_DIVIDEND_WITHDRAWAL_NONPOSITIVE");
  }
  return [
    {
      accountCode: "3202",
      debit: input.amount,
      description: `Pencairan dividen ${input.investorName}`,
    },
    {
      accountCode: input.bankAccountCode,
      credit: input.amount,
      description: `Transfer ke ${input.bankDestinationLabel}`,
    },
  ];
}

/**
 * Reversal: swap Dr/Cr. Restore Hutang Dividen + tarik kas balik dari bank.
 *
 *   Dr <bank account>          amount  (kas balik dari bank)
 *      Cr 3202 Hutang Dividen   amount  (restore liability)
 *
 * Caller pass `reason` untuk audit trail description.
 */
export function mapDividendWithdrawalReversal(
  input: DividendWithdrawalMappingInput & { reason: string },
): JournalLineInput[] {
  if (input.amount <= 0) {
    throw new Error("MAP_DIVIDEND_WITHDRAWAL_REVERSAL_NONPOSITIVE");
  }
  const reasonShort = input.reason.slice(0, 100);
  return [
    {
      accountCode: input.bankAccountCode,
      debit: input.amount,
      description: `Reversal transfer dari ${input.bankDestinationLabel}: ${reasonShort}`,
    },
    {
      accountCode: "3202",
      credit: input.amount,
      description: `Restore hutang dividen ${input.investorName}: ${reasonShort}`,
    },
  ];
}

/**
 * Pure helper: resolve bank code dari bank.bankName text string.
 * Pattern sama dengan cashDeposit.resolveBankCodeFromDestination tapi
 * eksplisit untuk dividend flow. Fallback 1112 Bank Lain-lain.
 */
export function resolveBankCodeFromBankName(bankName: string): string {
  const lower = bankName.toLowerCase();
  if (lower.includes("bca")) return "1110";
  if (lower.includes("bri")) return "1111";
  if (lower.includes("bni")) return "1112"; // fallback
  return "1112";
}
