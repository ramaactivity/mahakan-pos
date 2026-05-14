import { describe, expect, it } from "vitest";
import {
  computePartialRefund,
  nextStatusAfterRefund,
  type RefundItemSnapshot,
} from "@/features/transactions/refund-pure";

const item = (
  id: string,
  quantity: number,
  subtotal: number,
  refundedQuantity = 0,
): RefundItemSnapshot => ({
  transactionItemId: id,
  quantity,
  refundedQuantity,
  subtotal,
});

describe("computePartialRefund — happy paths", () => {
  it("single item full quantity, no discount", () => {
    const snap = [item("a", 1, 20_000)];
    const r = computePartialRefund(
      [{ transactionItemId: "a", quantity: 1 }],
      snap,
      20_000,
      0,
      0,
      20_000,
    );
    expect(r.ok).toBe(true);
    expect(r.totalRefunded).toBe(20_000);
    expect(r.perItem).toEqual([
      { transactionItemId: "a", quantityRefunded: 1, amountRefunded: 20_000 },
    ]);
  });

  it("multiple items, partial qty per item, no discount", () => {
    const snap = [item("a", 2, 40_000), item("b", 3, 30_000)];
    const r = computePartialRefund(
      [
        { transactionItemId: "a", quantity: 1 },
        { transactionItemId: "b", quantity: 2 },
      ],
      snap,
      70_000,
      0,
      0,
      70_000,
    );
    expect(r.ok).toBe(true);
    expect(r.perItem).toEqual([
      { transactionItemId: "a", quantityRefunded: 1, amountRefunded: 20_000 },
      { transactionItemId: "b", quantityRefunded: 2, amountRefunded: 20_000 },
    ]);
    expect(r.totalRefunded).toBe(40_000);
  });

  it("with transaction-level discount — pro-rata allocation", () => {
    // subtotal 100k, discount 10k → effective 90k
    // item a: subtotal 60k → discount allocated 6k → effective 54k → per-unit 27k
    // item b: subtotal 40k → discount allocated 4k → effective 36k → per-unit 18k
    const snap = [item("a", 2, 60_000), item("b", 2, 40_000)];
    const r = computePartialRefund(
      [{ transactionItemId: "a", quantity: 1 }],
      snap,
      100_000,
      10_000,
      0,
      90_000,
    );
    expect(r.ok).toBe(true);
    expect(r.perItem).toEqual([
      { transactionItemId: "a", quantityRefunded: 1, amountRefunded: 27_000 },
    ]);
  });

  it("respects existing refunded quantity from prior events", () => {
    // 3 units, 1 already refunded; can refund up to 2 more
    const snap = [item("a", 3, 30_000, 1)];
    const r = computePartialRefund(
      [{ transactionItemId: "a", quantity: 2 }],
      snap,
      30_000,
      0,
      10_000, // 1 already refunded for 10k
      30_000,
    );
    expect(r.ok).toBe(true);
    expect(r.totalRefunded).toBe(20_000);
  });
});

describe("computePartialRefund — round-last-unit (sesi AE-44 audit fix)", () => {
  // Test cases proving zero loss vs pre-AE-44 formula yang kehilangan
  // 1-2 rupiah per partial sequence (akumulatif Rp 1-2 jt/tahun).

  it("full refund all units one-shot — exactly itemEffective (no loss)", () => {
    // subtotal 100k, discount 33k → effective 67k, 3 units
    // Old formula: floor(67k/3) × 3 = 22333 × 3 = 66999 (loss 1)
    // New formula: floor(67k × 3/3) - 0 = 67000 ✓
    const snap = [item("a", 3, 100_000)];
    const r = computePartialRefund(
      [{ transactionItemId: "a", quantity: 3 }],
      snap,
      100_000,
      33_000,
      0,
      67_000,
    );
    expect(r.ok).toBe(true);
    expect(r.totalRefunded).toBe(67_000);
  });

  it("partial sequence 1+1+1 of 3 with discount — accumulates to itemEffective", () => {
    // Same item: effective 67k, qty 3. Refund 1, then 1, then 1.
    // Old: 22333 × 3 = 66999 (loss 1)
    // New: 22333 + 22333 + 22334 = 67000 ✓ (last unit absorbs remainder)
    const effective = 67_000;
    // Refund #1: refundedQuantity = 0
    const snap1 = [item("a", 3, 100_000, 0)];
    const r1 = computePartialRefund(
      [{ transactionItemId: "a", quantity: 1 }],
      snap1,
      100_000,
      33_000,
      0,
      effective,
    );
    expect(r1.ok).toBe(true);
    expect(r1.totalRefunded).toBe(22_333);

    // Refund #2: refundedQuantity = 1
    const snap2 = [item("a", 3, 100_000, 1)];
    const r2 = computePartialRefund(
      [{ transactionItemId: "a", quantity: 1 }],
      snap2,
      100_000,
      33_000,
      22_333,
      effective,
    );
    expect(r2.ok).toBe(true);
    expect(r2.totalRefunded).toBe(22_333);

    // Refund #3: refundedQuantity = 2 — last unit eats the remainder
    const snap3 = [item("a", 3, 100_000, 2)];
    const r3 = computePartialRefund(
      [{ transactionItemId: "a", quantity: 1 }],
      snap3,
      100_000,
      33_000,
      44_666,
      effective,
    );
    expect(r3.ok).toBe(true);
    expect(r3.totalRefunded).toBe(22_334); // remainder absorbed

    const cumulative = r1.totalRefunded + r2.totalRefunded + r3.totalRefunded;
    expect(cumulative).toBe(67_000); // ZERO LOSS — full restoration
  });

  it("partial batch 2-then-1 of 3 with discount — total entitled", () => {
    // effective 67k, qty 3. Refund 2 in batch, then 1.
    // Old: (22333 × 2) + (22333 × 1) = 44666 + 22333 = 66999 (loss 1)
    // New: 44666 + 22334 = 67000 ✓
    const effective = 67_000;
    const snap1 = [item("a", 3, 100_000, 0)];
    const r1 = computePartialRefund(
      [{ transactionItemId: "a", quantity: 2 }],
      snap1,
      100_000,
      33_000,
      0,
      effective,
    );
    expect(r1.ok).toBe(true);
    expect(r1.totalRefunded).toBe(44_666);

    const snap2 = [item("a", 3, 100_000, 2)];
    const r2 = computePartialRefund(
      [{ transactionItemId: "a", quantity: 1 }],
      snap2,
      100_000,
      33_000,
      44_666,
      effective,
    );
    expect(r2.ok).toBe(true);
    expect(r2.totalRefunded).toBe(22_334);

    expect(r1.totalRefunded + r2.totalRefunded).toBe(67_000);
  });

  it("no discount full refund — clean integer no remainder", () => {
    const snap = [item("a", 4, 100_000)];
    const r = computePartialRefund(
      [{ transactionItemId: "a", quantity: 4 }],
      snap,
      100_000,
      0,
      0,
      100_000,
    );
    expect(r.ok).toBe(true);
    expect(r.totalRefunded).toBe(100_000);
  });

  it("partial 1 of 7 with awkward divisor — first unit gets floor", () => {
    // subtotal 10k, qty 7 → effective 10k. floor(10000 × 1/7) = 1428
    const snap = [item("a", 7, 10_000)];
    const r = computePartialRefund(
      [{ transactionItemId: "a", quantity: 1 }],
      snap,
      10_000,
      0,
      0,
      10_000,
    );
    expect(r.ok).toBe(true);
    expect(r.totalRefunded).toBe(1_428);
  });

  it("partial 7 of 7 awkward divisor — exactly subtotal", () => {
    // Refund all 7 in one go: floor(10000 × 7/7) = 10000 (zero loss)
    const snap = [item("a", 7, 10_000)];
    const r = computePartialRefund(
      [{ transactionItemId: "a", quantity: 7 }],
      snap,
      10_000,
      0,
      0,
      10_000,
    );
    expect(r.ok).toBe(true);
    expect(r.totalRefunded).toBe(10_000);
  });

  it("legacy compat — prior refund stored via old formula still refundable", () => {
    // Skenario: pre-AE-44 sudah refund 1 of 3 (22333 stored). Sekarang refund 2 lagi.
    // entitledBefore = floor(67000 × 1/3) = 22333 (kebetulan match legacy stored)
    // entitledAfter = floor(67000 × 3/3) = 67000
    // delta = 67000 - 22333 = 44667 → kasi balikin sisa benar.
    const snap = [item("a", 3, 100_000, 1)];
    const r = computePartialRefund(
      [{ transactionItemId: "a", quantity: 2 }],
      snap,
      100_000,
      33_000,
      22_333, // legacy stored amount
      67_000,
    );
    expect(r.ok).toBe(true);
    expect(r.totalRefunded).toBe(44_667);
    // Total restored = 22333 (legacy) + 44667 (new) = 67000 ✓
  });
});

describe("computePartialRefund — validation errors", () => {
  it("empty input rejected", () => {
    const r = computePartialRefund([], [], 0, 0, 0, 0);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("EMPTY_INPUT");
  });

  it("unknown item id rejected", () => {
    const snap = [item("a", 1, 20_000)];
    const r = computePartialRefund(
      [{ transactionItemId: "ghost", quantity: 1 }],
      snap,
      20_000,
      0,
      0,
      20_000,
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("ITEM_NOT_FOUND");
  });

  it("requesting more than available qty rejected", () => {
    const snap = [item("a", 2, 40_000, 1)]; // 1 remaining
    const r = computePartialRefund(
      [{ transactionItemId: "a", quantity: 2 }],
      snap,
      40_000,
      0,
      20_000,
      40_000,
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("EXCEEDS_AVAILABLE");
  });

  it("zero or negative quantity rejected", () => {
    const snap = [item("a", 1, 20_000)];
    expect(
      computePartialRefund(
        [{ transactionItemId: "a", quantity: 0 }],
        snap,
        20_000,
        0,
        0,
        20_000,
      ).ok,
    ).toBe(false);
    expect(
      computePartialRefund(
        [{ transactionItemId: "a", quantity: -1 }],
        snap,
        20_000,
        0,
        0,
        20_000,
      ).ok,
    ).toBe(false);
  });

  it("amount over outstanding rejected", () => {
    // discount 10k, total 90k, already refunded 80k → outstanding 10k
    // Try refund 1 unit @ 27k → over outstanding
    const snap = [item("a", 2, 60_000), item("b", 2, 40_000)];
    const r = computePartialRefund(
      [{ transactionItemId: "a", quantity: 1 }],
      snap,
      100_000,
      10_000,
      80_000,
      90_000,
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("AMOUNT_OVER_OUTSTANDING");
  });
});

describe("nextStatusAfterRefund", () => {
  it("zero cumulative → paid", () => {
    expect(nextStatusAfterRefund(0, 100_000)).toBe("paid");
  });

  it("partial cumulative → partially_refunded", () => {
    expect(nextStatusAfterRefund(50_000, 100_000)).toBe("partially_refunded");
  });

  it("full cumulative → refunded", () => {
    expect(nextStatusAfterRefund(100_000, 100_000)).toBe("refunded");
  });

  it("over-cumulative → refunded (defensive)", () => {
    // Shouldn't happen, but if rounding pushes it over, status is still refunded
    expect(nextStatusAfterRefund(100_001, 100_000)).toBe("refunded");
  });
});
