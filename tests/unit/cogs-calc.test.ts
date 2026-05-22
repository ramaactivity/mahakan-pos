import { describe, expect, it } from "vitest";
import {
  computeIngredientCogs,
  parseMonthlyPeriod,
  previousMonth,
  summarizeCogs,
  type IngredientCogsInput,
  type IngredientCogsRow,
} from "@/features/cogs/cogs-calc";

const BASE: IngredientCogsInput = {
  ingredientId: "i-1",
  name: "Beans Houseblend",
  unit: "g",
  section: "bar",
  stockAwalQty: 5,
  stockAwalAvgPrice: 12_807,
  pembelianQty: 113,
  pembelianTotal: 1_485_479, // implies avg pembelian = 13_146
  stockAkhirQty: 17,
  theoreticalUsageQty: 101,
  currentCostPerUnit: 13_000,
};

describe("computeIngredientCogs — WAC formula", () => {
  it("computes WAC from stock awal + pembelian (mirror spreadsheet)", () => {
    const r = computeIngredientCogs(BASE);
    // (5 × 12807 + 1485479) / (5 + 113) = (64035 + 1485479) / 118 = 1549514 / 118 = 13_131.47
    expect(r.averagePrice).toBe(13_131);
    expect(r.stockAwalTotal).toBe(64_035);
    expect(r.pembelianAvgPrice).toBe(13_146);
  });

  it("computes COGS qty = awal + pembelian - akhir", () => {
    const r = computeIngredientCogs(BASE);
    // 5 + 113 - 17 = 101
    expect(r.cogsQty).toBe(101);
  });

  it("computes COGS total = qty × avg price (unrounded for accuracy)", () => {
    const r = computeIngredientCogs(BASE);
    // 101 × 13131.4746 = 1_326_279 (more accurate than 101 × 13131 = 1_326_231)
    expect(r.cogsTotal).toBe(1_326_279);
  });

  it("computes stock akhir total = qty × avg price (unrounded)", () => {
    const r = computeIngredientCogs(BASE);
    // 17 × 13131.4746 = 223_235 (more accurate than 17 × 13131 = 223_227)
    expect(r.stockAkhirTotal).toBe(223_235);
  });
});

describe("computeIngredientCogs — Variance", () => {
  it("computes variance = actual - theoretical (zero variance case)", () => {
    const r = computeIngredientCogs({ ...BASE, theoreticalUsageQty: 101 });
    expect(r.varianceQty).toBe(0);
    expect(r.variancePct).toBe(0);
    expect(r.varianceCost).toBe(0);
  });

  it("flags positive variance (used more than recipe suggests)", () => {
    // actual=101, theoretical=90 → variance=+11
    const r = computeIngredientCogs({ ...BASE, theoreticalUsageQty: 90 });
    expect(r.varianceQty).toBe(11);
    expect(r.variancePct).toBeCloseTo(12.22, 1);
    // variance cost = 11 × 13131.4746 = 144_446 (unrounded WAC × qty)
    expect(r.varianceCost).toBe(144_446);
  });

  it("flags negative variance (used less than recipe suggests)", () => {
    // actual=101, theoretical=120 → variance=-19
    const r = computeIngredientCogs({ ...BASE, theoreticalUsageQty: 120 });
    expect(r.varianceQty).toBe(-19);
    expect(r.variancePct).toBeCloseTo(-15.83, 1);
  });

  it("variancePct null when theoretical = 0", () => {
    const r = computeIngredientCogs({ ...BASE, theoreticalUsageQty: 0 });
    expect(r.variancePct).toBeNull();
  });
});

describe("computeIngredientCogs — edge cases", () => {
  it("handles no stock awal + no pembelian → fallback to currentCostPerUnit", () => {
    const r = computeIngredientCogs({
      ...BASE,
      stockAwalQty: 0,
      pembelianQty: 0,
      pembelianTotal: 0,
      stockAkhirQty: 5,
      currentCostPerUnit: 5_000,
    });
    expect(r.averagePrice).toBe(5_000);
    // Negative COGS = stock akhir > totalQty
    expect(r.cogsQty).toBe(-5);
    expect(r.warnings.some((w) => w.includes("Stock akhir"))).toBe(true);
  });

  it("warns when no opname akhir (stockAkhir=0 but theoretical >0)", () => {
    const r = computeIngredientCogs({
      ...BASE,
      stockAkhirQty: 0,
      theoreticalUsageQty: 50,
    });
    expect(r.warnings.some((w) => w.includes("opname"))).toBe(true);
  });

  it("handles purchase only (no awal, no akhir, no theoretical)", () => {
    const r = computeIngredientCogs({
      ...BASE,
      stockAwalQty: 0,
      stockAkhirQty: 0,
      theoreticalUsageQty: 0,
    });
    // WAC = total pembelian / qty = 1485479 / 113 = 13_146
    expect(r.averagePrice).toBe(13_146);
    expect(r.cogsQty).toBe(113);
  });
});

describe("parseMonthlyPeriod", () => {
  it("parses YYYY-MM format", () => {
    const p = parseMonthlyPeriod("2026-05");
    expect(p.ym).toBe("2026-05");
    expect(p.fromDate).toBe("2026-05-01");
    expect(p.toDate).toBe("2026-05-31");
    expect(p.label).toBe("Mei 2026");
  });

  it("computes correct last day for February (non-leap)", () => {
    const p = parseMonthlyPeriod("2026-02");
    expect(p.toDate).toBe("2026-02-28");
  });

  it("computes correct last day for February (leap year)", () => {
    const p = parseMonthlyPeriod("2024-02");
    expect(p.toDate).toBe("2024-02-29");
  });

  it("throws on invalid format", () => {
    expect(() => parseMonthlyPeriod("2026/05")).toThrow();
    expect(() => parseMonthlyPeriod("2026-13")).toThrow();
  });
});

describe("previousMonth", () => {
  it("returns previous month within same year", () => {
    expect(previousMonth("2026-05")).toBe("2026-04");
  });

  it("wraps to previous year in January", () => {
    expect(previousMonth("2026-01")).toBe("2025-12");
  });
});

describe("summarizeCogs", () => {
  it("sums per-section + total + variance count", () => {
    const rows: IngredientCogsRow[] = [
      mockRow({ section: "kitchen", cogsTotal: 1_000_000, varianceQty: 5, varianceCost: 50_000 }),
      mockRow({ section: "kitchen", cogsTotal: 500_000, varianceQty: 0, varianceCost: 0 }),
      mockRow({ section: "bar", cogsTotal: 2_000_000, varianceQty: -3, varianceCost: -30_000 }),
      mockRow({ section: null, cogsTotal: 100_000, varianceQty: 0, varianceCost: 0 }),
    ];
    const s = summarizeCogs(rows);
    expect(s.total).toBe(3_600_000);
    expect(s.bySection.kitchen).toBe(1_500_000);
    expect(s.bySection.bar).toBe(2_000_000);
    expect(s.bySection.unassigned).toBe(100_000);
    expect(s.ingredientsWithVariance).toBe(2);
    expect(s.totalVarianceCost).toBe(20_000); // 50_000 + (-30_000)
  });
});

function mockRow(overrides: Partial<IngredientCogsRow>): IngredientCogsRow {
  return {
    ingredientId: "test",
    name: "Test",
    unit: "g",
    section: null,
    stockAwalQty: 0,
    stockAwalAvgPrice: 0,
    stockAwalTotal: 0,
    pembelianQty: 0,
    pembelianAvgPrice: 0,
    pembelianTotal: 0,
    averagePrice: 0,
    stockAkhirQty: 0,
    stockAkhirAvgPrice: 0,
    stockAkhirTotal: 0,
    cogsQty: 0,
    cogsAvgPrice: 0,
    cogsTotal: 0,
    theoreticalUsageQty: 0,
    actualUsageQty: 0,
    varianceQty: 0,
    variancePct: null,
    varianceCost: 0,
    warnings: [],
    ...overrides,
  };
}
