/**
 * mapPosSale — POS sale → journal lines.
 *
 * Input: transaction header + items + (optional) splitPayments rows.
 * Output: balanced journal lines list (debit total === credit total).
 *
 * Mapping per design doc §4.1-4.3:
 *   Dr <kas/piutang per paymentMethod>      total
 *   Dr 4110 Diskon Penjualan                discountAmount  (kalau > 0)
 *      Cr 4101/4102/4103 Penjualan          per category bucket
 *   Dr 5101/5102/5103 HPP                   per category bucket
 *      Cr 1140/1141/1142 Persediaan         per category bucket
 *
 * Discount allocation: discount diserap proporsional dari food+drink+other
 * subtotals. Akun kontra 4110 di-debit total sekali (bukan per bucket) supaya
 * laporan diskon visible sebagai single line.
 *
 * Compliment (reason starts with "Compliment:") TIDAK dihandle di sini —
 * gunakan mapPosCompliment (kontra journal: only COGS movement, no revenue).
 */

import { paymentMethodLabel } from "@/lib/payment-method";
import type { JournalLineInput } from "../posting";
import { aggregateByCategory, type AggregatedItem } from "./categoryMapper";

export type PosSalePaymentMethod =
  | "cash"
  | "qris"
  | "card_bca"
  | "card_bni"
  | "card_mandiri"
  | "card_bri"
  | "card_other"
  | "split";

export type SplitPaymentRow = {
  /** Each split row's actual cash receipt method. */
  paymentMethod:
    | "cash"
    | "qris"
    | "card_bca"
    | "card_bni"
    | "card_mandiri"
    | "card_bri"
    | "card_other";
  amount: number;
};

export type PosSaleInput = {
  /** transactions.id */
  transactionId: string;
  /** transactions.transactionNumber for description */
  transactionNumber: string;
  /** transactions.outletId */
  outletId: string;
  /** Date of sale (YYYY-MM-DD WIB) */
  entryDate: string;
  paymentMethod: PosSalePaymentMethod;
  /** transactions.total */
  total: number;
  /** transactions.subtotal */
  subtotal: number;
  /** transactions.discountAmount */
  discountAmount: number;
  /** Items aggregated by category for revenue/COGS. */
  items: AggregatedItem[];
  /** When paymentMethod='split', breakdown per method. Sum must = total. */
  splits?: SplitPaymentRow[];
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
  cash: "1101", // Kas Tunai (Drawer POS)
  qris: "1120", // Piutang QRIS
  card_bca: "1121", // Piutang EDC BCA
  card_bni: "1125", // Piutang EDC BNI
  card_mandiri: "1126", // Piutang EDC Mandiri
  card_bri: "1127", // Piutang EDC BRI
  card_other: "1128", // Piutang EDC Lainnya (catch-all)
};

export function mapPosSale(input: PosSaleInput): JournalLineInput[] {
  const lines: JournalLineInput[] = [];

  // ---------- Revenue side (Dr cash/piutang + Dr discount kontra) ----------

  if (input.paymentMethod === "split") {
    if (!input.splits || input.splits.length === 0) {
      throw new Error("MAP_POS_SALE_SPLIT_MISSING");
    }
    const splitSum = input.splits.reduce((s, sp) => s + sp.amount, 0);
    if (splitSum !== input.total) {
      throw new Error(
        `MAP_POS_SALE_SPLIT_MISMATCH:expected=${input.total},got=${splitSum}`,
      );
    }
    for (const sp of input.splits) {
      if (sp.amount === 0) continue;
      lines.push({
        accountCode: PAYMENT_METHOD_TO_ACCOUNT[sp.paymentMethod],
        debit: sp.amount,
        description: `Uang masuk ${paymentMethodLabel(sp.paymentMethod)} (bayar split)`,
      });
    }
  } else {
    lines.push({
      accountCode: PAYMENT_METHOD_TO_ACCOUNT[input.paymentMethod],
      debit: input.total,
      description: `Uang masuk ${paymentMethodLabel(input.paymentMethod)}`,
    });
  }

  if (input.discountAmount > 0) {
    lines.push({
      accountCode: "4110",
      debit: input.discountAmount,
      description: "Diskon penjualan",
    });
  }

  // ---------- Revenue credits per bucket ----------

  const buckets = aggregateByCategory(input.items);

  // Discount diserap proporsional. subtotal sebelum discount = sum(buckets.amount).
  // Net per bucket = bucket.amount - bucket.amount * (discount/subtotal).
  // Tapi credit revenue tetap by GROSS subtotal (4110 sudah di-debit di atas).
  // Sumcheck: Dr (kas+4110) = total + discount = subtotal. Cr revenue = subtotal. ✅

  if (buckets.food.amount > 0) {
    lines.push({
      accountCode: "4101",
      credit: buckets.food.amount,
      description: "Penjualan makanan",
    });
  }
  if (buckets.drink.amount > 0) {
    lines.push({
      accountCode: "4102",
      credit: buckets.drink.amount,
      description: "Penjualan minuman",
    });
  }
  if (buckets.other.amount > 0) {
    lines.push({
      accountCode: "4103",
      credit: buckets.other.amount,
      description: "Penjualan lain",
    });
  }

  // ---------- COGS recognition ----------
  // Per-bucket: Dr HPP, Cr Persediaan. Skip kalau cogs=0 (no recipe data yet).

  if (buckets.food.cogs > 0) {
    lines.push({
      accountCode: "5101",
      debit: buckets.food.cogs,
      description: "HPP makanan",
    });
    lines.push({
      accountCode: "1140",
      credit: buckets.food.cogs,
      description: "Persediaan kitchen",
    });
  }
  if (buckets.drink.cogs > 0) {
    lines.push({
      accountCode: "5102",
      debit: buckets.drink.cogs,
      description: "HPP minuman",
    });
    lines.push({
      accountCode: "1141",
      credit: buckets.drink.cogs,
      description: "Persediaan bar",
    });
  }
  if (buckets.other.cogs > 0) {
    lines.push({
      accountCode: "5103",
      debit: buckets.other.cogs,
      description: "HPP lain",
    });
    lines.push({
      accountCode: "1142",
      credit: buckets.other.cogs,
      description: "Persediaan pendukung",
    });
  }

  return lines;
}
