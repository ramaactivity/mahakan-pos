import { describe, expect, it } from "vitest";
import {
  computeShiftCashSummary,
  type ShiftTxnRow,
} from "@/features/shifts/close-pure";

const txn = (
  status: ShiftTxnRow["status"],
  paymentMethod: string,
  total: number,
  refundedAmount = 0,
): ShiftTxnRow => ({ status, paymentMethod, total, refundedAmount });

describe("computeShiftCashSummary — paid status", () => {
  it("counts cash payment di paidCash + paidCount", () => {
    const summary = computeShiftCashSummary([
      txn("paid", "cash", 50_000),
      txn("paid", "cash", 30_000),
    ]);
    expect(summary.paidCount).toBe(2);
    expect(summary.paidCash).toBe(80_000);
    expect(summary.paidQris).toBe(0);
    expect(summary.paidCard).toBe(0);
    expect(summary.refundedCount).toBe(0);
    expect(summary.refundedCash).toBe(0);
  });

  it("separates qris vs cash vs card", () => {
    const summary = computeShiftCashSummary([
      txn("paid", "cash", 50_000),
      txn("paid", "qris", 30_000),
      txn("paid", "card_bca", 20_000),
    ]);
    expect(summary.paidCash).toBe(50_000);
    expect(summary.paidQris).toBe(30_000);
    expect(summary.paidCard).toBe(20_000);
  });
});

describe("computeShiftCashSummary — voided status", () => {
  it("voided tidak masuk paidCash atau refundedCash", () => {
    const summary = computeShiftCashSummary([
      txn("voided", "cash", 50_000),
      txn("paid", "cash", 30_000),
    ]);
    expect(summary.voidedCount).toBe(1);
    expect(summary.voidedAmount).toBe(50_000);
    expect(summary.paidCount).toBe(1);
    expect(summary.paidCash).toBe(30_000);
  });
});

describe("computeShiftCashSummary — refunded (full) status", () => {
  it("full refund cash: added ke refundedCash dengan total", () => {
    const summary = computeShiftCashSummary([
      txn("refunded", "cash", 50_000, 50_000),
    ]);
    expect(summary.refundedCount).toBe(1);
    expect(summary.refundedAmount).toBe(50_000);
    expect(summary.refundedCash).toBe(50_000);
    expect(summary.paidCash).toBe(0);
  });

  it("full refund qris: refundedCash tidak terpengaruh", () => {
    const summary = computeShiftCashSummary([
      txn("refunded", "qris", 30_000, 30_000),
    ]);
    expect(summary.refundedAmount).toBe(30_000);
    expect(summary.refundedCash).toBe(0);
  });
});

describe("computeShiftCashSummary — partially_refunded status (sesi AE-44 FIX)", () => {
  // Sebelum AE-44: branch ini tidak ada → partial refund LOST in calc.
  // expectedCash = openingCash + paidCash - refundedCash → variance alarm
  // palsu untuk kasir yang sudah balikin cash refund (tampak kurang setor).

  it("partial cash refund: paidCash counts total + refundedCash counts refunded", () => {
    // Transaksi total 50k cash, partial refund 20k cash. Drawer net = +30k.
    const summary = computeShiftCashSummary([
      txn("partially_refunded", "cash", 50_000, 20_000),
    ]);
    expect(summary.paidCount).toBe(1);
    expect(summary.refundedCount).toBe(1);
    expect(summary.paidCash).toBe(50_000); // original payment
    expect(summary.refundedCash).toBe(20_000); // partial refund out
    expect(summary.refundedAmount).toBe(20_000);
    // Net drawer impact = paidCash - refundedCash = 30_000 (matches physical).
  });

  it("partial qris refund: paidQris counts total, refundedCash NOT affected (qris bukan cash)", () => {
    const summary = computeShiftCashSummary([
      txn("partially_refunded", "qris", 50_000, 15_000),
    ]);
    expect(summary.paidQris).toBe(50_000);
    expect(summary.refundedCash).toBe(0);
    expect(summary.refundedAmount).toBe(15_000);
  });

  it("partial refundedAmount=0 (edge: status set but no actual refund) — safe", () => {
    const summary = computeShiftCashSummary([
      txn("partially_refunded", "cash", 50_000, 0),
    ]);
    expect(summary.paidCash).toBe(50_000);
    expect(summary.refundedCash).toBe(0);
  });
});

describe("computeShiftCashSummary — mixed scenario", () => {
  it("real-world shift: paid + voided + full refund + partial refund", () => {
    const summary = computeShiftCashSummary([
      txn("paid", "cash", 50_000),
      txn("paid", "qris", 30_000),
      txn("voided", "cash", 25_000),
      txn("refunded", "cash", 40_000, 40_000),
      txn("partially_refunded", "cash", 60_000, 25_000),
    ]);
    // Paid: cash 50k + partial-original 60k = 110k cash, qris 30k.
    // Refunded: full 40k cash + partial 25k cash = 65k cash refund.
    // Voided: 25k tracked.
    expect(summary.paidCount).toBe(3); // 2 paid + 1 partial
    expect(summary.paidCash).toBe(110_000);
    expect(summary.paidQris).toBe(30_000);
    expect(summary.voidedCount).toBe(1);
    expect(summary.voidedAmount).toBe(25_000);
    expect(summary.refundedCount).toBe(2);
    expect(summary.refundedAmount).toBe(65_000);
    expect(summary.refundedCash).toBe(65_000);

    // Net drawer for cash: opening + 110_000 - 65_000 = opening + 45_000
    // Physical reality:
    //   paid: +50k (paid cash) → drawer +50k
    //   partial: +60k (original cash) -25k (refund) = +35k → drawer +35k
    //   refund (full): +40k (original) -40k (refund) = 0 → drawer 0
    //   voided: 0 (assume cancelled before settle)
    // Total drawer = +85k. But formula gives +45k.
    //
    // Diskrepansi = 40k (the full refund cash). Ini bug pre-existing
    // (out of scope AE-44 fix per owner directive). Out-of-scope DOC:
    // formula treat full refund sebagai net negative impact (-total),
    // padahal physically 0 (received then returned). Future fix: also
    // add total to paidCash for "refunded" branch. For sekarang, partial
    // sudah benar.
  });

  it("multiple partial refunds — accumulates correctly", () => {
    const summary = computeShiftCashSummary([
      txn("partially_refunded", "cash", 50_000, 10_000),
      txn("partially_refunded", "cash", 80_000, 20_000),
      txn("partially_refunded", "cash", 100_000, 35_000),
    ]);
    expect(summary.paidCount).toBe(3);
    expect(summary.refundedCount).toBe(3);
    expect(summary.paidCash).toBe(230_000);
    expect(summary.refundedCash).toBe(65_000);
    expect(summary.refundedAmount).toBe(65_000);
  });
});
