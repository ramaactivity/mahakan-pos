import { describe, expect, it } from "vitest";
import {
  computeBaseSalary,
  computeThrSuggestion,
  countLinesWithManualEdits,
  hasManualEdits,
  recomputeGrossNetV2,
} from "@/features/payroll/payroll-compute-pure";

describe("computeBaseSalary", () => {
  it("daily mechanism: dailyRate × workDays", () => {
    const r = computeBaseSalary({
      paymentType: "daily",
      salaryAmount: 0,
      dailyRate: 100_000,
      workDays: 22,
    });
    expect(r.baseSalary).toBe(2_200_000);
    expect(r.resolvedType).toBe("daily");
    expect(r.warning).toBeNull();
  });

  it("monthly mechanism: salaryAmount flat regardless of workDays", () => {
    const r = computeBaseSalary({
      paymentType: "monthly",
      salaryAmount: 5_000_000,
      dailyRate: null,
      workDays: 18,
    });
    expect(r.baseSalary).toBe(5_000_000);
    expect(r.resolvedType).toBe("monthly");
  });

  it("legacy NULL paymentType → fallback to monthly", () => {
    const r = computeBaseSalary({
      paymentType: null,
      salaryAmount: 3_000_000,
      dailyRate: null,
      workDays: 0,
    });
    expect(r.baseSalary).toBe(3_000_000);
    expect(r.resolvedType).toBe("monthly");
  });

  it("daily + null dailyRate → 0 + warning", () => {
    const r = computeBaseSalary({
      paymentType: "daily",
      salaryAmount: 0,
      dailyRate: null,
      workDays: 22,
    });
    expect(r.baseSalary).toBe(0);
    expect(r.warning).toContain("tarif harian");
  });

  it("daily + workDays=0 → 0, no warning", () => {
    const r = computeBaseSalary({
      paymentType: "daily",
      salaryAmount: 0,
      dailyRate: 100_000,
      workDays: 0,
    });
    expect(r.baseSalary).toBe(0);
    expect(r.warning).toBeNull();
  });

  it("monthly negative salaryAmount → floor to 0", () => {
    const r = computeBaseSalary({
      paymentType: "monthly",
      salaryAmount: -100,
      dailyRate: null,
      workDays: 0,
    });
    expect(r.baseSalary).toBe(0);
  });

  it("daily rate dengan decimal workDays handled (round)", () => {
    const r = computeBaseSalary({
      paymentType: "daily",
      salaryAmount: 0,
      dailyRate: 75_500,
      workDays: 21.5,
    });
    expect(r.baseSalary).toBe(Math.round(75_500 * 21.5)); // 1623250
  });
});

describe("computeThrSuggestion", () => {
  it("default multiplier 1.0 → baseSalary flat", () => {
    expect(computeThrSuggestion(2_000_000, 1.0)).toBe(2_000_000);
  });

  it("multiplier 1.5 → 1.5× baseSalary", () => {
    expect(computeThrSuggestion(2_000_000, 1.5)).toBe(3_000_000);
  });

  it("multiplier 0 → 0 (fallback to default 1)", () => {
    // 0 is not >0, so falls back to multiplier=1
    expect(computeThrSuggestion(1_000_000, 0)).toBe(1_000_000);
  });

  it("invalid multiplier (NaN) → fallback to 1", () => {
    expect(computeThrSuggestion(1_000_000, Number.NaN)).toBe(1_000_000);
  });

  it("zero baseSalary → 0", () => {
    expect(computeThrSuggestion(0, 1.5)).toBe(0);
  });
});

describe("recomputeGrossNetV2", () => {
  it("all components → correct gross + net", () => {
    const r = recomputeGrossNetV2({
      baseSalary: 3_000_000,
      overtimePay: 200_000,
      bonus: 500_000,
      thr: 0,
      lateDeduction: 50_000,
      advanceDeduction: 200_000,
      otherDeductions: 100_000,
    });
    // gross = 3jt + 200k + 500k = 3.7jt
    expect(r.grossPay).toBe(3_700_000);
    // net = 3.7jt - 50k - 200k - 100k = 3.35jt
    expect(r.netPay).toBe(3_350_000);
  });

  it("THR boost gross", () => {
    const r = recomputeGrossNetV2({
      baseSalary: 2_000_000,
      overtimePay: 0,
      bonus: 0,
      thr: 2_000_000,
      lateDeduction: 0,
      advanceDeduction: 0,
      otherDeductions: 0,
    });
    expect(r.grossPay).toBe(4_000_000);
    expect(r.netPay).toBe(4_000_000);
  });

  it("net floors to 0 (no negative)", () => {
    const r = recomputeGrossNetV2({
      baseSalary: 100_000,
      overtimePay: 0,
      bonus: 0,
      thr: 0,
      lateDeduction: 0,
      advanceDeduction: 500_000,
      otherDeductions: 0,
    });
    expect(r.netPay).toBe(0);
  });

  it("zero input → zero output", () => {
    const r = recomputeGrossNetV2({
      baseSalary: 0,
      overtimePay: 0,
      bonus: 0,
      thr: 0,
      lateDeduction: 0,
      advanceDeduction: 0,
      otherDeductions: 0,
    });
    expect(r.grossPay).toBe(0);
    expect(r.netPay).toBe(0);
  });
});

describe("hasManualEdits + countLinesWithManualEdits", () => {
  it("returns false when all manual fields = 0", () => {
    expect(
      hasManualEdits({
        bonus: 0,
        thr: 0,
        advanceDeduction: 0,
        otherDeductions: 0,
      }),
    ).toBe(false);
  });

  it("returns true when bonus > 0", () => {
    expect(
      hasManualEdits({
        bonus: 100_000,
        thr: 0,
        advanceDeduction: 0,
        otherDeductions: 0,
      }),
    ).toBe(true);
  });

  it("returns true when thr > 0", () => {
    expect(
      hasManualEdits({
        bonus: 0,
        thr: 1_000_000,
        advanceDeduction: 0,
        otherDeductions: 0,
      }),
    ).toBe(true);
  });

  it("countLinesWithManualEdits sums correctly", () => {
    const lines = [
      { bonus: 0, thr: 0, advanceDeduction: 0, otherDeductions: 0 },
      { bonus: 500_000, thr: 0, advanceDeduction: 0, otherDeductions: 0 },
      { bonus: 0, thr: 2_000_000, advanceDeduction: 0, otherDeductions: 0 },
      {
        bonus: 0,
        thr: 0,
        advanceDeduction: 100_000,
        otherDeductions: 50_000,
      },
    ];
    expect(countLinesWithManualEdits(lines)).toBe(3);
  });
});
