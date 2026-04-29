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
