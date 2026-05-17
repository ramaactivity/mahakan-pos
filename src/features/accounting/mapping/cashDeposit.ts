/**
 * mapCashDepositVerified — cash deposit verify (Owner approve) → journal lines.
 *
 * Mapping per design doc §4.9:
 *   Dr <bank account>                       deposit.amount
 *      Cr 1101 Kas Tunai                    deposit.amount
 *
 * Bank account resolution (Q3 Owner-confirmed dropdown):
 *   1. Kalau cashDeposits.bankAccountId set → resolve to that account.code
 *   2. Else → fallback heuristic dari bankDestination string:
 *      - lowercase contains "bca" → 1110 Bank BCA
 *      - lowercase contains "bri" → 1111 Bank BRI
 *      - else → 1112 Bank Lain-lain
 *   3. Caller resolves bankAccountId via accountResolver and passes account.code.
 */

import type { JournalLineInput } from "../posting";

export type CashDepositVerifiedInput = {
  cashDepositId: string;
  outletId: string;
  /** Date deposit verified (YYYY-MM-DD WIB). Use deposit_date if available, fallback verifiedAt. */
  entryDate: string;
  amount: number;
  /** Pre-resolved bank account code (1110/1111/1112/etc). */
  bankAccountCode: string;
  /** Free-text deskripsi yang Owner enter di bankDestination — untuk audit trail line description. */
  bankDestinationLabel: string;
  /** Reference number kalau ada (slip bank). */
  referenceNo?: string | null;
};

/**
 * Pure helper: derive bank account code from free-text bank destination string.
 * Used as fallback kalau bankAccountId not set.
 */
export function resolveBankCodeFromDestination(destination: string): string {
  const lower = destination.toLowerCase();
  if (lower.includes("bca")) return "1110";
  if (lower.includes("bri")) return "1111";
  return "1112";
}

export function mapCashDepositVerified(
  input: CashDepositVerifiedInput,
): JournalLineInput[] {
  if (input.amount <= 0) {
    throw new Error("MAP_CASH_DEPOSIT_NONPOSITIVE");
  }

  const desc = input.referenceNo
    ? `Setoran ke ${input.bankDestinationLabel} (${input.referenceNo})`
    : `Setoran ke ${input.bankDestinationLabel}`;

  return [
    {
      accountCode: input.bankAccountCode,
      debit: input.amount,
      description: desc,
    },
    {
      accountCode: "1101",
      credit: input.amount,
      description: "Setoran tunai keluar dari kas drawer",
    },
  ];
}

/**
 * Sesi AE-62h — mapCashDepositUnverified: reverse mapping untuk
 * unverify action. Mirror dari mapCashDepositVerified dengan debit/credit
 * di-swap. Reason di-append ke description supaya audit trail jelas.
 *
 * Mapping:
 *   Dr 1101 Kas Tunai                        deposit.amount  (uang balik ke laci)
 *      Cr <bank account>                     deposit.amount  (cancel bank deposit)
 */
export function mapCashDepositUnverified(
  input: CashDepositVerifiedInput & { reason: string },
): JournalLineInput[] {
  if (input.amount <= 0) {
    throw new Error("MAP_CASH_DEPOSIT_UNVERIFY_NONPOSITIVE");
  }
  const desc = `REVERT setoran ke ${input.bankDestinationLabel}: ${input.reason}`;
  return [
    {
      accountCode: "1101",
      debit: input.amount,
      description: `${desc} (kas drawer di-restore)`,
    },
    {
      accountCode: input.bankAccountCode,
      credit: input.amount,
      description: desc,
    },
  ];
}
