/**
 * Sesi AE-80 — Mapping helper untuk share buyback journal.
 *
 * Saat outlet beli kembali share dari investor (share_transactions
 * kind='company_buyback'):
 *   Dr 3401 Treasury Stock     amount  (kontra-equity, kurangi total ekuitas)
 *      Cr <bank account>       amount  (kas keluar)
 *
 * Reversal: swap Dr/Cr.
 *
 * P2P transfer dan top_up/initial NOT mapped di sini:
 *   - p2p_transfer: no journal (uang antar pribadi, di luar buku)
 *   - top_up/initial: Dr Kas / Cr 3101 Modal (handled di mapping
 *     terpisah atau action level — Phase 2 fokus buyback dulu)
 */

import type { JournalLineInput } from "../posting";

const ACCOUNT_TREASURY_STOCK = "3401";

export interface ShareBuybackMappingInput {
  /** Amount kas yang dibayar ke investor (Rupiah). */
  amount: number;
  /** Pre-resolved bank COA code. */
  bankAccountCode: string;
  /** Display label untuk description. */
  bankDestinationLabel: string;
  /** Investor name + share % yang dibeli (untuk audit). */
  investorName: string;
  sharePctDelta: number;
}

export function mapShareBuyback(
  input: ShareBuybackMappingInput,
): JournalLineInput[] {
  if (input.amount <= 0) {
    throw new Error("MAP_SHARE_BUYBACK_NONPOSITIVE");
  }
  return [
    {
      accountCode: ACCOUNT_TREASURY_STOCK,
      debit: input.amount,
      description: `Buyback ${input.sharePctDelta.toFixed(4)}% saham ${input.investorName}`,
    },
    {
      accountCode: input.bankAccountCode,
      credit: input.amount,
      description: `Transfer buyback ke ${input.bankDestinationLabel}`,
    },
  ];
}

export function mapShareBuybackReversal(
  input: ShareBuybackMappingInput & { reason: string },
): JournalLineInput[] {
  if (input.amount <= 0) {
    throw new Error("MAP_SHARE_BUYBACK_REVERSAL_NONPOSITIVE");
  }
  const reasonShort = input.reason.slice(0, 100);
  return [
    {
      accountCode: input.bankAccountCode,
      debit: input.amount,
      description: `Reversal buyback dari ${input.bankDestinationLabel}: ${reasonShort}`,
    },
    {
      accountCode: ACCOUNT_TREASURY_STOCK,
      credit: input.amount,
      description: `Restore share ${input.investorName}: ${reasonShort}`,
    },
  ];
}
