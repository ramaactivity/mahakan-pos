/**
 * Sesi AE-80 follow-up — Convert investor → kreditur journal mapping.
 *
 * Investor exit dengan modal-nya di-reclassify jadi hutang kreditur.
 * Equity (3101 Modal Owner) berkurang, liability (2150 Hutang Kreditur)
 * bertambah. Tidak ada cash flow — murni reclass akuntansi.
 *
 *   Dr 3101 Modal Owner       principalIdr
 *     Cr 2150 Hutang Kreditur  principalIdr
 */

import type { JournalLineInput } from "../posting";

const ACCOUNT_MODAL_OWNER = "3101";
const ACCOUNT_HUTANG_KREDITUR = "2150";

export interface InvestorToCreditorConversionInput {
  /** Modal disetor yang dikonversi jadi pokok hutang kreditur (Rupiah). */
  principalIdr: number;
  investorName: string;
  creditorName: string;
}

export function mapInvestorToCreditorConversion(
  input: InvestorToCreditorConversionInput,
): JournalLineInput[] {
  const amount = Math.max(0, Math.floor(input.principalIdr));
  return [
    {
      accountCode: ACCOUNT_MODAL_OWNER,
      debit: amount,
      credit: 0,
      description: `Konversi modal ${input.investorName} → hutang kreditur`,
    },
    {
      accountCode: ACCOUNT_HUTANG_KREDITUR,
      debit: 0,
      credit: amount,
      description: `Pengakuan hutang kreditur ${input.creditorName} (dari investor exit)`,
    },
  ];
}
