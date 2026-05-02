/**
 * mapAggregatorSettlement — manual settlement entry → channel-aware journal.
 *
 * 5 channels, 2 patterns:
 *
 * (A) qris / edc_bca — POS sale dah create piutang (1120/1121). Settlement =
 *     piutang clearing event. Per design doc §4.10:
 *       Dr <bank account>                  net
 *       Dr 6402 Biaya QRIS / EDC (MDR)     fee
 *          Cr 1120 / 1121 Piutang          gross
 *
 * (B) gofood / grabfood / shopeefood — POS GAK record per-order (Q1 decision).
 *     Settlement = revenue recognition + bank inflow. Per Q1:
 *       Dr <bank account>                  net
 *       Dr 6401 Biaya Aggregator           fee
 *          Cr 4104 Penjualan via Aggregator  gross
 *
 *     COGS gak di-recognize (acceptable gap, P&L footnote menjelaskan).
 *
 * Bank account resolution sama seperti cashDeposit: bankAccountId atau fallback
 * default 1110 Bank BCA (aggregator settlements masuk ke BCA per default).
 */

import type { JournalLineInput } from "../posting";

export type AggregatorChannel =
  | "edc_bca"
  | "gofood"
  | "grabfood"
  | "shopeefood"
  | "qris";

export type AggregatorSettlementInput = {
  settlementId: string;
  outletId: string;
  /** Date bank credited (YYYY-MM-DD WIB). Pakai bank_credited_at kalau ada,
   * else use settlement.created_at fallback. */
  entryDate: string;
  channel: AggregatorChannel;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  /** Pre-resolved bank account code (default 1110 kalau bankAccountId null). */
  bankAccountCode: string;
  /** Period label "Apr 1-30, 2026" — untuk description. */
  periodLabel: string;
  referenceNo?: string | null;
};

export function isPiutangChannel(channel: AggregatorChannel): boolean {
  return channel === "qris" || channel === "edc_bca";
}

/**
 * Map channel ke piutang account code.
 *
 * Note: gofood/grabfood/shopeefood TIDAK punya piutang account active —
 * mereka langsung Cr revenue 4104 di settlement entry.
 */
export function piutangCodeForChannel(
  channel: AggregatorChannel,
): string | null {
  switch (channel) {
    case "qris":
      return "1120";
    case "edc_bca":
      return "1121";
    default:
      return null;
  }
}

export function mapAggregatorSettlement(
  input: AggregatorSettlementInput,
): JournalLineInput[] {
  if (input.grossAmount <= 0) {
    throw new Error("MAP_AGG_SETTLE_NONPOSITIVE");
  }
  if (input.feeAmount < 0 || input.feeAmount > input.grossAmount) {
    throw new Error("MAP_AGG_SETTLE_FEE_BOUNDS");
  }
  if (input.netAmount !== input.grossAmount - input.feeAmount) {
    throw new Error(
      `MAP_AGG_SETTLE_NET_MISMATCH:gross=${input.grossAmount},fee=${input.feeAmount},net=${input.netAmount}`,
    );
  }

  const lines: JournalLineInput[] = [];

  // Dr Bank net
  lines.push({
    accountCode: input.bankAccountCode,
    debit: input.netAmount,
    description: `Settlement ${input.channel} ${input.periodLabel}${input.referenceNo ? ` (${input.referenceNo})` : ""}`,
  });

  // Dr Fee (kalau > 0)
  if (input.feeAmount > 0) {
    if (isPiutangChannel(input.channel)) {
      // QRIS/EDC fee = MDR
      lines.push({
        accountCode: "6402",
        debit: input.feeAmount,
        description: `Biaya MDR ${input.channel}`,
      });
    } else {
      // GoFood/Grab/Shopee fee = aggregator commission
      lines.push({
        accountCode: "6401",
        debit: input.feeAmount,
        description: `Biaya aggregator ${input.channel}`,
      });
    }
  }

  // Cr side: piutang clearing OR revenue recognition
  if (isPiutangChannel(input.channel)) {
    const piutangCode = piutangCodeForChannel(input.channel)!;
    lines.push({
      accountCode: piutangCode,
      credit: input.grossAmount,
      description: `Clear piutang ${input.channel}`,
    });
  } else {
    lines.push({
      accountCode: "4104",
      credit: input.grossAmount,
      description: `Penjualan via ${input.channel}`,
    });
  }

  return lines;
}
