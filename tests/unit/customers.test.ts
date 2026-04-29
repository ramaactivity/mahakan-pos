import { describe, expect, it } from "vitest";
// Pull pure helpers directly from `types` to avoid the actions.ts barrel
// which connects to Postgres at module load.
import {
  clampRedemption,
  computePointsEarned,
  computeRedemptionAmount,
  normalisePhone,
  POINTS_PER_RUPIAH,
  RUPIAH_PER_POINT_REDEEMED,
} from "@/features/customers/types";

describe("computePointsEarned", () => {
  it("zero or negative spend returns 0", () => {
    expect(computePointsEarned(0)).toBe(0);
    expect(computePointsEarned(-50_000)).toBe(0);
  });

  it("Rp 1000 = 1 point (default ratio)", () => {
    expect(computePointsEarned(1_000)).toBe(1);
    expect(computePointsEarned(50_000)).toBe(50);
    expect(computePointsEarned(125_000)).toBe(125);
  });

  it("floors fractional points (Rp 999 = 0)", () => {
    expect(computePointsEarned(999)).toBe(0);
    expect(computePointsEarned(1_999)).toBe(1);
    expect(computePointsEarned(2_999)).toBe(2);
  });

  it("ratio constant is 1/1000", () => {
    expect(POINTS_PER_RUPIAH).toBe(1 / 1000);
  });
});

describe("normalisePhone", () => {
  it("strips +, spaces, dashes, parens", () => {
    expect(normalisePhone("+62 812-3456-7890")).toBe("6281234567890");
    expect(normalisePhone("(021) 555-1234")).toBe("0215551234");
    expect(normalisePhone("0812.3456.7890")).toBe("081234567890");
  });

  it("returns null for input shorter than 6 digits", () => {
    expect(normalisePhone("123")).toBeNull();
    expect(normalisePhone("")).toBeNull();
    expect(normalisePhone("---")).toBeNull();
    expect(normalisePhone("12345")).toBeNull();
  });

  it("preserves leading 0 vs 62 distinction (stored as typed)", () => {
    // Both are valid Indonesian phone forms — we don't auto-convert one
    // to the other. Owner can normalise via Admin UI later if needed.
    expect(normalisePhone("081234567890")).toBe("081234567890");
    expect(normalisePhone("6281234567890")).toBe("6281234567890");
  });

  it("handles unicode digits gracefully (non-ASCII stripped)", () => {
    expect(normalisePhone("0812-456-789💀")).toBe("0812456789");
  });

  it("accepts exactly 6 digits as valid threshold", () => {
    expect(normalisePhone("123456")).toBe("123456");
    expect(normalisePhone("12 34 56")).toBe("123456");
  });
});

describe("computeRedemptionAmount", () => {
  it("zero or negative points returns 0 rupiah", () => {
    expect(computeRedemptionAmount(0)).toBe(0);
    expect(computeRedemptionAmount(-5)).toBe(0);
  });

  it("1 point = Rp 1000 (mirror of earn ratio)", () => {
    expect(computeRedemptionAmount(1)).toBe(1_000);
    expect(computeRedemptionAmount(50)).toBe(50_000);
    expect(computeRedemptionAmount(125)).toBe(125_000);
  });

  it("floors fractional point input", () => {
    expect(computeRedemptionAmount(2.7)).toBe(2_000);
    expect(computeRedemptionAmount(99.999)).toBe(99_000);
  });

  it("ratio constant is Rp 1000 per point", () => {
    expect(RUPIAH_PER_POINT_REDEEMED).toBe(1_000);
  });
});

describe("clampRedemption", () => {
  it("returns 0 for zero / negative request, balance, or subtotal", () => {
    expect(clampRedemption(0, 100, 200_000)).toBe(0);
    expect(clampRedemption(-5, 100, 200_000)).toBe(0);
    expect(clampRedemption(50, 0, 200_000)).toBe(0);
    expect(clampRedemption(50, 100, 0)).toBe(0);
  });

  it("limits to balance when balance is the binding constraint", () => {
    // request 100 pt, has 30, plenty of subtotal → clamp to 30
    expect(clampRedemption(100, 30, 1_000_000)).toBe(30);
  });

  it("limits to subtotal when subtotal is the binding constraint", () => {
    // request 100 pt = Rp 100k, but subtotal only Rp 35k = 35 pt allowed
    expect(clampRedemption(100, 500, 35_000)).toBe(35);
  });

  it("respects partial-rupiah subtotals via floor", () => {
    // Rp 35,500 only redeems 35 points (Rp 35,000) — 36 would over-redeem
    expect(clampRedemption(100, 500, 35_500)).toBe(35);
  });

  it("returns the exact request when within all caps", () => {
    expect(clampRedemption(20, 100, 200_000)).toBe(20);
  });

  it("floors fractional requested points", () => {
    expect(clampRedemption(20.7, 100, 200_000)).toBe(20);
  });

  it("non-finite request guarded", () => {
    expect(clampRedemption(NaN, 100, 200_000)).toBe(0);
    expect(clampRedemption(Infinity, 100, 200_000)).toBe(0);
  });
});
