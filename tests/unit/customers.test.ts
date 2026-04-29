import { describe, expect, it } from "vitest";
// Pull pure helpers directly from `types` to avoid the actions.ts barrel
// which connects to Postgres at module load.
import {
  computePointsEarned,
  normalisePhone,
  POINTS_PER_RUPIAH,
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
