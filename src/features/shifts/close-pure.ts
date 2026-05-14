/**
 * Pure aggregation helper untuk shift close. No DB, no `server-only` —
 * unit-testable dari any context.
 *
 * Sesi AE-44 (audit fix) — extracted dari actions.ts supaya bisa
 * di-cover dengan tests. Bug original: partial_refunded transaction
 * tidak masuk perhitungan paidCash / refundedCash → expectedCash salah
 * → variance alarm palsu di shift close.
 */

export type ShiftTxnStatus =
  | "paid"
  | "voided"
  | "refunded"
  | "partially_refunded"
  | "open";

export interface ShiftTxnRow {
  status: ShiftTxnStatus;
  paymentMethod: string;
  total: number;
  refundedAmount: number;
}

export interface ShiftCashSummary {
  paidCount: number;
  paidCash: number;
  paidQris: number;
  paidCard: number;
  voidedCount: number;
  voidedAmount: number;
  refundedCount: number;
  refundedAmount: number;
  refundedCash: number;
}

/**
 * Aggregate cash/qris/card flows + refund totals dari array transaksi
 * shift. Pure function — input array, output ringkasan.
 *
 * Branch logic:
 *   - paid: original payment baru masuk drawer, belum ada refund.
 *   - voided: tidak masuk drawer (assumed canceled before settlement).
 *   - refunded (full): original payment was received then fully returned.
 *     (Note: existing legacy behavior count -total ke refundedCash;
 *     hasil net drawer impact -total padahal physically 0. Bug pre-existing,
 *     out of scope AE-44 fix per owner directive.)
 *   - partially_refunded: AE-44 NEW BRANCH. Original payment masuk drawer
 *     (paidCash += total) DAN refund cash keluar (refundedCash += refundedAmount).
 *     Net = total - refundedAmount, matches physical drawer.
 */
export function computeShiftCashSummary(
  txns: ShiftTxnRow[],
): ShiftCashSummary {
  let paidCount = 0;
  let paidCash = 0;
  let paidQris = 0;
  let paidCard = 0;
  let voidedCount = 0;
  let voidedAmount = 0;
  let refundedCount = 0;
  let refundedAmount = 0;
  let refundedCash = 0;

  for (const t of txns) {
    if (t.status === "paid") {
      paidCount += 1;
      if (t.paymentMethod === "cash") paidCash += t.total;
      else if (t.paymentMethod === "qris") paidQris += t.total;
      else paidCard += t.total;
    } else if (t.status === "voided") {
      voidedCount += 1;
      voidedAmount += t.total;
    } else if (t.status === "refunded") {
      /* Sesi AE-45 (continuation audit AE-44 finding) — full refund:
       * dulu cuma count `refundedCash += total` TANPA add original
       * payment ke paidCash. Effect: expectedCash = opening + 0 - total
       * = opening - total, padahal physical drawer opening + total
       * (received) - total (refunded) = opening. Variance = +total per
       * full refund (false POSITIVE alarm).
       *
       * Fix: count original payment di paidCash/paidQris/paidCard.
       * Net dengan refundedCash = 0, matches physical drawer. Konsisten
       * dengan branch partially_refunded (AE-44). */
      paidCount += 1;
      refundedCount += 1;
      refundedAmount += t.total;
      if (t.paymentMethod === "cash") {
        paidCash += t.total;
        refundedCash += t.total;
      } else if (t.paymentMethod === "qris") {
        paidQris += t.total;
      } else {
        paidCard += t.total;
      }
    } else if (t.status === "partially_refunded") {
      paidCount += 1;
      refundedCount += 1;
      const refValue = t.refundedAmount ?? 0;
      refundedAmount += refValue;
      if (t.paymentMethod === "cash") {
        paidCash += t.total;
        refundedCash += refValue;
      } else if (t.paymentMethod === "qris") {
        paidQris += t.total;
      } else {
        paidCard += t.total;
      }
    }
  }

  return {
    paidCount,
    paidCash,
    paidQris,
    paidCard,
    voidedCount,
    voidedAmount,
    refundedCount,
    refundedAmount,
    refundedCash,
  };
}
