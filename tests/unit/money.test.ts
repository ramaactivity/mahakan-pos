import { describe, it, expect } from "vitest";
import {
  computeDiscountAmount,
  computeTotal,
  computeItemSubtotal,
  formatRupiah,
  parseRupiah,
  bankersRound,
  isValidPriceRange,
} from "@/lib/money";

describe("bankersRound", () => {
  it("rounds toward floor for diff < 0.5", () => {
    expect(bankersRound(12.4)).toBe(12);
    expect(bankersRound(13.1)).toBe(13);
  });

  it("rounds toward ceiling for diff > 0.5", () => {
    expect(bankersRound(12.6)).toBe(13);
    expect(bankersRound(13.9)).toBe(14);
  });

  it("rounds exact .5 to even", () => {
    expect(bankersRound(12.5)).toBe(12); // 12 even
    expect(bankersRound(13.5)).toBe(14); // 14 even
    expect(bankersRound(0.5)).toBe(0); // 0 even
    expect(bankersRound(1.5)).toBe(2); // 2 even
    expect(bankersRound(2.5)).toBe(2); // 2 even
    expect(bankersRound(3.5)).toBe(4); // 4 even
  });

  it("handles integers unchanged", () => {
    expect(bankersRound(10)).toBe(10);
    expect(bankersRound(0)).toBe(0);
  });

  it("throws on non-finite input", () => {
    expect(() => bankersRound(NaN)).toThrow();
    expect(() => bankersRound(Infinity)).toThrow();
    expect(() => bankersRound(-Infinity)).toThrow();
  });
});

describe("computeDiscountAmount", () => {
  describe("with null discount", () => {
    it("returns 0", () => {
      expect(computeDiscountAmount(50_000, null)).toBe(0);
    });
  });

  describe("with fixed discount", () => {
    it("returns the fixed amount when less than subtotal", () => {
      expect(
        computeDiscountAmount(50_000, { type: "fixed", value: 10_000 }),
      ).toBe(10_000);
    });

    it("caps at subtotal when fixed value exceeds subtotal", () => {
      expect(
        computeDiscountAmount(50_000, { type: "fixed", value: 60_000 }),
      ).toBe(50_000);
    });

    it("returns 0 when fixed value is 0", () => {
      expect(computeDiscountAmount(50_000, { type: "fixed", value: 0 })).toBe(
        0,
      );
    });

    it("returns 0 for negative fixed value (defensive)", () => {
      expect(
        computeDiscountAmount(50_000, { type: "fixed", value: -5_000 }),
      ).toBe(0);
    });
  });

  describe("with percent discount", () => {
    it("computes 10% of 50000 as 5000", () => {
      expect(
        computeDiscountAmount(50_000, { type: "percent", value: 10 }),
      ).toBe(5_000);
    });

    it("computes 100% as full subtotal", () => {
      expect(
        computeDiscountAmount(37_000, { type: "percent", value: 100 }),
      ).toBe(37_000);
    });

    it("computes 0% as 0", () => {
      expect(
        computeDiscountAmount(50_000, { type: "percent", value: 0 }),
      ).toBe(0);
    });

    it("returns 0 for negative percent value (defensive)", () => {
      expect(
        computeDiscountAmount(50_000, { type: "percent", value: -5 }),
      ).toBe(0);
    });

    it("caps at subtotal when percent > 100", () => {
      expect(
        computeDiscountAmount(50_000, { type: "percent", value: 150 }),
      ).toBe(50_000);
    });

    // Banker's rounding edge cases
    it("rounds half to even: 50% of 25 → 12", () => {
      expect(
        computeDiscountAmount(25, { type: "percent", value: 50 }),
      ).toBe(12);
    });

    it("rounds half to even: 50% of 27 → 14", () => {
      expect(
        computeDiscountAmount(27, { type: "percent", value: 50 }),
      ).toBe(14);
    });

    it("handles 7% of 1000 = 70", () => {
      expect(
        computeDiscountAmount(1_000, { type: "percent", value: 7 }),
      ).toBe(70);
    });

    it("rounds 7% of 1025 (71.75) to 72", () => {
      expect(
        computeDiscountAmount(1_025, { type: "percent", value: 7 }),
      ).toBe(72);
    });

    it("handles 50% of max rupiah — 500_000_000 (banker's round)", () => {
      // 999_999_999 * 0.5 = 499_999_999.5 → bankers → 500_000_000 (even)
      expect(
        computeDiscountAmount(999_999_999, { type: "percent", value: 50 }),
      ).toBe(500_000_000);
    });

    it("always returns an integer", () => {
      const result = computeDiscountAmount(17, {
        type: "percent",
        value: 33,
      });
      expect(Number.isInteger(result)).toBe(true);
    });
  });

  describe("input validation", () => {
    it("throws on non-integer subtotal", () => {
      expect(() =>
        computeDiscountAmount(50_000.5, { type: "fixed", value: 1_000 }),
      ).toThrow();
    });

    it("throws on negative subtotal", () => {
      expect(() =>
        computeDiscountAmount(-100, { type: "fixed", value: 1_000 }),
      ).toThrow();
    });

    it("throws on non-integer discount value", () => {
      expect(() =>
        computeDiscountAmount(50_000, { type: "percent", value: 10.5 }),
      ).toThrow();
    });
  });
});

describe("computeTotal", () => {
  it("subtracts discount from subtotal", () => {
    expect(computeTotal(50_000, 5_000)).toBe(45_000);
  });

  it("returns 0 when discount exceeds subtotal (floor)", () => {
    expect(computeTotal(10_000, 15_000)).toBe(0);
  });

  it("returns subtotal when discount is 0", () => {
    expect(computeTotal(50_000, 0)).toBe(50_000);
  });

  it("throws on non-integer inputs", () => {
    expect(() => computeTotal(50_000.5, 0)).toThrow();
    expect(() => computeTotal(50_000, 1_000.5)).toThrow();
  });

  it("throws on negative subtotal", () => {
    expect(() => computeTotal(-1, 0)).toThrow();
  });
});

describe("computeItemSubtotal", () => {
  it("multiplies price and quantity", () => {
    expect(computeItemSubtotal(16_000, 0, 2)).toBe(32_000);
  });

  it("includes modifier delta in unit price", () => {
    expect(computeItemSubtotal(16_000, 8_000, 2)).toBe(48_000);
  });

  it("returns 0 for quantity 0", () => {
    expect(computeItemSubtotal(16_000, 0, 0)).toBe(0);
  });

  it("handles zero modifier delta", () => {
    expect(computeItemSubtotal(21_000, 0, 3)).toBe(63_000);
  });

  it("handles negative modifier delta (defensive, e.g. future voucher stack)", () => {
    expect(computeItemSubtotal(20_000, -5_000, 2)).toBe(30_000);
  });

  it("throws on non-integer unit price", () => {
    expect(() => computeItemSubtotal(16_000.5, 0, 1)).toThrow();
  });

  it("throws on non-integer quantity", () => {
    expect(() => computeItemSubtotal(16_000, 0, 1.5)).toThrow();
  });

  it("throws on negative quantity", () => {
    expect(() => computeItemSubtotal(16_000, 0, -1)).toThrow();
  });
});

describe("formatRupiah", () => {
  it('formats 1250000 as "Rp 1.250.000"', () => {
    expect(formatRupiah(1_250_000)).toBe("Rp 1.250.000");
  });

  it('formats 0 as "Rp 0"', () => {
    expect(formatRupiah(0)).toBe("Rp 0");
  });

  it('formats small amount "Rp 500"', () => {
    expect(formatRupiah(500)).toBe("Rp 500");
  });

  it('formats exact thousand "Rp 1.000"', () => {
    expect(formatRupiah(1_000)).toBe("Rp 1.000");
  });

  it('formats negative "Rp -10.000"', () => {
    expect(formatRupiah(-10_000)).toBe("Rp -10.000");
  });

  it("formats max price 999.999.999", () => {
    expect(formatRupiah(999_999_999)).toBe("Rp 999.999.999");
  });

  /* Sesi AE-63 phase7 — formatRupiah dulu THROW on non-integer (strict
   * data integrity guard). Tapi UI caller pass computed total dari decimal
   * arithmetic (mis. opname preview accumulate qty × cost) → throw crash
   * UI → error boundary "Back office bermasalah". Sekarang display
   * function ROUND defensively; strict integer assertion belong di
   * storage boundary (Zod, DB write), bukan di display. */
  it("rounds non-integer instead of throwing", () => {
    expect(formatRupiah(123.45)).toBe("Rp 123");
    expect(formatRupiah(6801792.6)).toBe("Rp 6.801.793");
    expect(formatRupiah(-10000.7)).toBe("Rp -10.001");
  });

  it("returns 'Rp 0' for NaN / Infinity (defensive)", () => {
    expect(formatRupiah(NaN)).toBe("Rp 0");
    expect(formatRupiah(Infinity)).toBe("Rp 0");
    expect(formatRupiah(-Infinity)).toBe("Rp 0");
  });
});

describe("parseRupiah", () => {
  it('parses "1.250.000" to 1250000', () => {
    expect(parseRupiah("1.250.000")).toBe(1_250_000);
  });

  it('parses "Rp 1.250.000" to 1250000', () => {
    expect(parseRupiah("Rp 1.250.000")).toBe(1_250_000);
  });

  it('parses raw "1250000"', () => {
    expect(parseRupiah("1250000")).toBe(1_250_000);
  });

  it('parses "Rp 0" to 0', () => {
    expect(parseRupiah("Rp 0")).toBe(0);
  });

  it('parses negative "Rp -10.000" to -10000', () => {
    expect(parseRupiah("Rp -10.000")).toBe(-10_000);
  });

  it("throws on alphabetical input", () => {
    expect(() => parseRupiah("abc")).toThrow();
  });

  it('throws on "Rp " (empty after strip)', () => {
    expect(() => parseRupiah("Rp ")).toThrow();
  });

  it("throws on empty string", () => {
    expect(() => parseRupiah("")).toThrow();
  });

  it("throws on mixed content", () => {
    expect(() => parseRupiah("Rp 1abc")).toThrow();
  });

  it("throws on non-string input (defensive)", () => {
    // @ts-expect-error — intentionally testing defensive runtime check
    expect(() => parseRupiah(12345)).toThrow("non-string input");
    // @ts-expect-error null is not assignable to string — defensive runtime check
    expect(() => parseRupiah(null)).toThrow("non-string input");
    // @ts-expect-error undefined is not assignable to string — defensive runtime check
    expect(() => parseRupiah(undefined)).toThrow("non-string input");
  });
});

describe("isValidPriceRange", () => {
  it("accepts 0", () => {
    expect(isValidPriceRange(0)).toBe(true);
  });

  it("accepts max value 999_999_999", () => {
    expect(isValidPriceRange(999_999_999)).toBe(true);
  });

  it("rejects negative", () => {
    expect(isValidPriceRange(-1)).toBe(false);
  });

  it("rejects above max", () => {
    expect(isValidPriceRange(1_000_000_000)).toBe(false);
  });

  it("rejects non-integer", () => {
    expect(isValidPriceRange(10.5)).toBe(false);
  });

  it("rejects NaN", () => {
    expect(isValidPriceRange(NaN)).toBe(false);
  });
});
