/**
 * Fixed Asset mappers — Sesi X (Phase 2 accounting tier extension).
 *
 * 2 events:
 *   1. Capitalization (acquisition) — Dr <asset account 1201-1204> Cr <kas/bank>
 *      Replaces normal expense flow kalau Owner toggle "Capitalize" saat
 *      buat asset (atau create asset langsung tanpa link ke purchase).
 *   2. Monthly Depreciation — Dr <beban penyusutan 6501-6504> Cr <1290 Akum
 *      Penyusutan>. Straight-line per asset: monthly = (cost - salvage) /
 *      useful_life_months. Computed pure-function tested untuk handle
 *      rounding (last month catches any cumulative rounding leftover).
 */

import type { JournalLineInput } from "../posting";

// ============================================================
// Capitalization
// ============================================================

export type CapitalizeAssetPaymentMethod =
  | "cash"
  | "transfer_bca"
  | "transfer_bri"
  | "transfer_other";

export type CapitalizeAssetInput = {
  assetId: string;
  assetName: string;
  outletId: string;
  entryDate: string;
  cost: number;
  /** Pre-resolved chart_of_accounts.code for asset side (1201-1204). */
  assetAccountCode: string;
  paymentMethod: CapitalizeAssetPaymentMethod;
};

const CASH_BANK_CODE: Record<CapitalizeAssetPaymentMethod, string> = {
  cash: "1101",
  transfer_bca: "1110",
  transfer_bri: "1111",
  transfer_other: "1112",
};

export function mapCapitalizeAsset(
  input: CapitalizeAssetInput,
): JournalLineInput[] {
  if (input.cost <= 0) {
    throw new Error("MAP_CAPITALIZE_NONPOSITIVE");
  }
  return [
    {
      accountCode: input.assetAccountCode,
      debit: input.cost,
      description: `Pengadaan ${input.assetName}`,
    },
    {
      accountCode: CASH_BANK_CODE[input.paymentMethod],
      credit: input.cost,
      description: `Pembayaran ${input.paymentMethod}: ${input.assetName}`,
    },
  ];
}

// ============================================================
// Monthly Depreciation
// ============================================================

export type DepreciationLineInput = {
  assetId: string;
  assetName: string;
  /** Acquisition cost. */
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  depreciationAccountCode: string;
  accumulatedDepreciationAccountCode: string;
  /** Bulan ke berapa di-depreciate (1-indexed dari acquired month). Caller
   * compute via lastDepreciatedMonth + targetMonth. */
  monthIndex: number;
};

export type MonthlyDepreciationInput = {
  outletId: string;
  /** First day of period being depreciated (YYYY-MM-DD). E.g. "2026-06-01"
   * untuk Juni depreciation, posted di akhir bulan. */
  periodFirstDay: string;
  /** "Juni 2026" — for description. */
  periodLabel: string;
  assets: DepreciationLineInput[];
};

/**
 * Compute monthly depreciation amount per asset.
 *
 * Pure straight-line:
 *   total_depreciable = cost - salvageValue
 *   per_month = floor(total_depreciable / useful_life_months)
 *
 * Last month catch-up: kalau monthIndex === useful_life_months, kembalikan
 * residual (total_depreciable - per_month * (useful_life_months - 1)) supaya
 * cumulative match exactly cost-salvage (no rounding leftover).
 *
 * Beyond useful life: returns 0 (asset fully depreciated, skip).
 */
export function computeMonthlyDepreciation(args: {
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  monthIndex: number;
}): number {
  if (args.monthIndex < 1) return 0;
  if (args.monthIndex > args.usefulLifeMonths) return 0;

  const totalDepreciable = args.cost - args.salvageValue;
  if (totalDepreciable <= 0) return 0;

  const perMonth = Math.floor(totalDepreciable / args.usefulLifeMonths);

  // Last-month catch-up: handle any rounding remainder.
  if (args.monthIndex === args.usefulLifeMonths) {
    return totalDepreciable - perMonth * (args.usefulLifeMonths - 1);
  }

  return perMonth;
}

/**
 * Build journal lines untuk single-month depreciation across multiple assets.
 * Aggregates per (depreciationAccountCode, accumulatedDepreciationAccountCode)
 * pair untuk reduce line count (kalau 5 asset furniture, 1 row Dr 6501 dan
 * 1 row Cr 1290 dengan total combined).
 */
export function mapMonthlyDepreciation(
  input: MonthlyDepreciationInput,
): JournalLineInput[] {
  type Bucket = { dep: number; accum: string; depCode: string };
  const buckets: Record<string, Bucket> = {};
  let totalDep = 0;

  for (const asset of input.assets) {
    const amount = computeMonthlyDepreciation({
      cost: asset.cost,
      salvageValue: asset.salvageValue,
      usefulLifeMonths: asset.usefulLifeMonths,
      monthIndex: asset.monthIndex,
    });
    if (amount === 0) continue;
    const key = `${asset.depreciationAccountCode}|${asset.accumulatedDepreciationAccountCode}`;
    if (!buckets[key]) {
      buckets[key] = {
        dep: 0,
        depCode: asset.depreciationAccountCode,
        accum: asset.accumulatedDepreciationAccountCode,
      };
    }
    buckets[key].dep += amount;
    totalDep += amount;
  }

  if (totalDep === 0) return [];

  const lines: JournalLineInput[] = [];
  // Group accumulated-depreciation lines per accum account (typically 1 = "1290").
  const accumByCode: Record<string, number> = {};
  for (const b of Object.values(buckets)) {
    lines.push({
      accountCode: b.depCode,
      debit: b.dep,
      description: `Beban penyusutan ${input.periodLabel}`,
    });
    accumByCode[b.accum] = (accumByCode[b.accum] ?? 0) + b.dep;
  }
  for (const [code, amount] of Object.entries(accumByCode)) {
    lines.push({
      accountCode: code,
      credit: amount,
      description: `Akumulasi penyusutan ${input.periodLabel}`,
    });
  }

  return lines;
}
