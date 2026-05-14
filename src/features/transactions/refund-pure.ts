/**
 * Pure helpers for partial refund computation. No DB, no `server-only` —
 * unit-testable from any context.
 *
 * Design rationale:
 * - Each transaction_item has its own subtotal (already includes modifier
 *   deltas at sale time, see transactionItems.subtotal column).
 * - Transaction-level discount is allocated PRO-RATA across items based
 *   on each item's share of the subtotal.
 * - When refunding N units of a specific item, the refund amount is
 *   N * (item's effective per-unit rupiah after pro-rata allocation).
 * - Per-unit math is integer-safe via banker's rounding for the share.
 */

export interface RefundItemInput {
  transactionItemId: string;
  /** Number of units to refund this round. Must be in (0, item.quantity - item.refundedQuantity]. */
  quantity: number;
}

export interface RefundItemSnapshot {
  transactionItemId: string;
  /** Original sale quantity. */
  quantity: number;
  /** Units already refunded in prior partial events. */
  refundedQuantity: number;
  /** Item subtotal at sale time (after modifier delta, before transaction-level discount). */
  subtotal: number;
  /** Pre-computed per-unit subtotal: floor(subtotal / quantity). For
   * uneven splits the LAST unit eats the rounding remainder. */
}

export interface PartialRefundComputation {
  ok: boolean;
  errorCode?:
    | "EMPTY_INPUT"
    | "ITEM_NOT_FOUND"
    | "EXCEEDS_AVAILABLE"
    | "AMOUNT_OVER_OUTSTANDING";
  errorMessage?: string;
  /** Per-item amount + qty (only when ok=true). */
  perItem: Array<{
    transactionItemId: string;
    quantityRefunded: number;
    amountRefunded: number;
  }>;
  /** Sum of perItem.amountRefunded. */
  totalRefunded: number;
}

/**
 * Compute pro-rata refund amounts for the requested items + quantities.
 *
 * @param items requested items with quantities to refund
 * @param snapshot current state of all transaction items (full + remaining)
 * @param transactionSubtotal sum of all transaction_items.subtotal
 * @param transactionDiscountAmount transaction-level discount allocation (in rupiah)
 * @param transactionRefundedAmount cumulative rupiah already refunded across prior events
 * @param transactionTotal post-discount total (subtotal - discountAmount)
 *
 * Returns per-item rupiah + total. Caller wraps in DB tx + writes refund_events.
 */
export function computePartialRefund(
  items: RefundItemInput[],
  snapshot: RefundItemSnapshot[],
  transactionSubtotal: number,
  transactionDiscountAmount: number,
  transactionRefundedAmount: number,
  transactionTotal: number,
): PartialRefundComputation {
  if (items.length === 0) {
    return {
      ok: false,
      errorCode: "EMPTY_INPUT",
      errorMessage: "Pilih minimal satu item untuk refund",
      perItem: [],
      totalRefunded: 0,
    };
  }

  const snapshotById = new Map(
    snapshot.map((s) => [s.transactionItemId, s] as const),
  );

  // Validate input + compute per-line refund amounts
  const perItem: Array<{
    transactionItemId: string;
    quantityRefunded: number;
    amountRefunded: number;
  }> = [];
  let runningTotal = 0;

  for (const req of items) {
    const item = snapshotById.get(req.transactionItemId);
    if (!item) {
      return {
        ok: false,
        errorCode: "ITEM_NOT_FOUND",
        errorMessage: `Item ${req.transactionItemId} tidak ditemukan di transaksi`,
        perItem: [],
        totalRefunded: 0,
      };
    }
    const remaining = item.quantity - item.refundedQuantity;
    if (req.quantity <= 0 || req.quantity > remaining) {
      return {
        ok: false,
        errorCode: "EXCEEDS_AVAILABLE",
        errorMessage: `Item ${req.transactionItemId}: minta refund ${req.quantity}, tersisa ${remaining}`,
        perItem: [],
        totalRefunded: 0,
      };
    }

    // Pro-rata effective per-unit rupiah:
    //   item.subtotal share of total = item.subtotal / transactionSubtotal
    //   discount allocated to item = transactionDiscountAmount * (item.subtotal / transactionSubtotal)
    //   item effective rupiah = item.subtotal - allocated discount
    //
    // Sesi AE-44 (audit fix) — Cumulative-entitled formula:
    //   amount(now) = floor(itemEffective × (refundedBefore + reqQty) / itemQty)
    //              - floor(itemEffective × refundedBefore / itemQty)
    //
    // Why: dulu pakai `perUnit × reqQty` yang kehilangan sisa rounding
    // (mis. itemEffective 67000 ÷ 3 unit = 22333 perUnit; refund 3 unit
    // sequential = 22333+22333+22333 = 66999, kehilangan Rp 1 per item
    // per partial sequence — akumulatif Rp 1-2 juta/tahun di laporan kas).
    //
    // Formula baru pakai "cumulative entitled minus already entitled":
    // sisa pembulatan otomatis nyebar ke unit terakhir. Untuk full refund
    // dalam satu call: floor(eff × N/N) = eff = zero loss. Untuk partial
    // sequential: total terkumpul akhirnya = itemEffective (zero loss).
    //
    // Backward-compat: untuk legacy refund pre-AE-44 yang sudah disimpan
    // pakai formula lama, `entitledBefore` (computed dari refundedQuantity)
    // ≡ jumlah yang sebenarnya sudah dibayar (bedanya max 1 rupiah per
    // line per partial sequence sebelumnya). Safe.
    const discountAllocation =
      transactionSubtotal > 0
        ? Math.floor(
            (transactionDiscountAmount * item.subtotal) / transactionSubtotal,
          )
        : 0;
    const itemEffective = item.subtotal - discountAllocation;
    const entitledBefore = Math.floor(
      (itemEffective * item.refundedQuantity) / item.quantity,
    );
    const entitledAfter = Math.floor(
      (itemEffective * (item.refundedQuantity + req.quantity)) /
        item.quantity,
    );
    const amountRefunded = entitledAfter - entitledBefore;

    perItem.push({
      transactionItemId: req.transactionItemId,
      quantityRefunded: req.quantity,
      amountRefunded,
    });
    runningTotal += amountRefunded;
  }

  // Outstanding rupiah on the transaction.
  const outstanding = transactionTotal - transactionRefundedAmount;
  if (runningTotal > outstanding) {
    return {
      ok: false,
      errorCode: "AMOUNT_OVER_OUTSTANDING",
      errorMessage: `Total refund Rp${runningTotal.toLocaleString("id-ID")} > sisa transaksi Rp${outstanding.toLocaleString("id-ID")}`,
      perItem: [],
      totalRefunded: 0,
    };
  }

  return {
    ok: true,
    perItem,
    totalRefunded: runningTotal,
  };
}

export type TransactionRefundStatus =
  | "paid"
  | "partially_refunded"
  | "refunded"
  | "voided"
  | "open";

/**
 * Determine the transaction's NEXT status after a refund event commits.
 *
 * - If new cumulative refunded === total → "refunded"
 * - If new cumulative refunded > 0 but < total → "partially_refunded"
 * - Else (0 cumulative) → "paid" (defensive — shouldn't happen post-refund)
 *
 * Caller must already have validated currentStatus is in {paid, partially_refunded}.
 */
export function nextStatusAfterRefund(
  newCumulativeRefunded: number,
  transactionTotal: number,
): TransactionRefundStatus {
  if (newCumulativeRefunded >= transactionTotal) return "refunded";
  if (newCumulativeRefunded > 0) return "partially_refunded";
  return "paid";
}
