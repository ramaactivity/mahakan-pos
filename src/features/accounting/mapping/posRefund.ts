/**
 * mapPosRefund — full or partial refund → reverse-direction journal lines.
 *
 * Mapping per design doc §4.5:
 *   Dr 4111 Refund Penjualan                refundedAmount
 *      Cr <kas/piutang per original paymentMethod>   refundedAmount
 *
 *   COGS reversal default OFF (Owner accepted Q5):
 *     Kalau opts.reverseCogs=true:
 *       Dr 1140/1141/1142 Persediaan         per bucket
 *          Cr 5101/5102/5103 HPP             per bucket
 */

import { paymentMethodLabel } from "@/lib/payment-method";
import type { JournalLineInput } from "../posting";
import { aggregateByCategory, type AggregatedItem } from "./categoryMapper";

export type PosRefundInput = {
  transactionId: string;
  /** Original transactions.transactionNumber */
  transactionNumber: string;
  outletId: string;
  /** Date refund posted (YYYY-MM-DD WIB). */
  entryDate: string;
  /** Original payment method — determines kas/piutang account. */
  originalPaymentMethod:
    | "cash"
    | "qris"
    | "card_bca"
    | "card_bni"
    | "card_mandiri"
    | "card_bri"
    | "card_other"
    | "split";
  /** Total refunded amount (may be partial). */
  refundedAmount: number;
  /** For split — breakdown of which methods to reverse, sum = refundedAmount. */
  splits?: {
    paymentMethod:
      | "cash"
      | "qris"
      | "card_bca"
      | "card_bni"
      | "card_mandiri"
      | "card_bri"
      | "card_other";
    amount: number;
  }[];
  /** Items refunded (for COGS reversal). amount + cogs per line. */
  items?: AggregatedItem[];
  /** Reverse COGS movement back to persediaan. Default false (barang habis). */
  reverseCogs?: boolean;
};

const PAYMENT_METHOD_TO_ACCOUNT: Record<
  | "cash"
  | "qris"
  | "card_bca"
  | "card_bni"
  | "card_mandiri"
  | "card_bri"
  | "card_other",
  string
> = {
  cash: "1101",
  qris: "1120",
  card_bca: "1121",
  card_bni: "1125",
  card_mandiri: "1126",
  card_bri: "1127",
  card_other: "1128",
};

export function mapPosRefund(input: PosRefundInput): JournalLineInput[] {
  const lines: JournalLineInput[] = [];

  // ---------- Refund debit ke kontra-revenue ----------
  lines.push({
    accountCode: "4111",
    debit: input.refundedAmount,
    description: `Refund TRX ${input.transactionNumber}`,
  });

  // ---------- Credit ke kas/piutang ----------
  if (input.originalPaymentMethod === "split") {
    if (!input.splits || input.splits.length === 0) {
      throw new Error("MAP_POS_REFUND_SPLIT_MISSING");
    }
    const splitSum = input.splits.reduce((s, sp) => s + sp.amount, 0);
    if (splitSum !== input.refundedAmount) {
      throw new Error(
        `MAP_POS_REFUND_SPLIT_MISMATCH:expected=${input.refundedAmount},got=${splitSum}`,
      );
    }
    for (const sp of input.splits) {
      if (sp.amount === 0) continue;
      lines.push({
        accountCode: PAYMENT_METHOD_TO_ACCOUNT[sp.paymentMethod],
        credit: sp.amount,
        description: `Uang keluar ${paymentMethodLabel(sp.paymentMethod)} (refund split)`,
      });
    }
  } else {
    lines.push({
      accountCode: PAYMENT_METHOD_TO_ACCOUNT[input.originalPaymentMethod],
      credit: input.refundedAmount,
      description: `Uang keluar ${paymentMethodLabel(input.originalPaymentMethod)} (refund)`,
    });
  }

  // ---------- Optional COGS reversal ----------
  if (input.reverseCogs && input.items && input.items.length > 0) {
    const buckets = aggregateByCategory(input.items);
    if (buckets.food.cogs > 0) {
      lines.push({
        accountCode: "1140",
        debit: buckets.food.cogs,
        description: "Persediaan kitchen (refund return)",
      });
      lines.push({
        accountCode: "5101",
        credit: buckets.food.cogs,
        description: "HPP makanan (reversal)",
      });
    }
    if (buckets.drink.cogs > 0) {
      lines.push({
        accountCode: "1141",
        debit: buckets.drink.cogs,
        description: "Persediaan bar (refund return)",
      });
      lines.push({
        accountCode: "5102",
        credit: buckets.drink.cogs,
        description: "HPP minuman (reversal)",
      });
    }
    if (buckets.other.cogs > 0) {
      lines.push({
        accountCode: "1142",
        debit: buckets.other.cogs,
        description: "Persediaan pendukung (refund return)",
      });
      lines.push({
        accountCode: "5103",
        credit: buckets.other.cogs,
        description: "HPP lain (reversal)",
      });
    }
  }

  return lines;
}
