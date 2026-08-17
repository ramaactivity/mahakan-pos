import { describe, expect, it } from "vitest";
import {
  computeIngredientCogs,
  computeNewWac,
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

/* Sesi AE-202 — mode periodic + belum opname di periode. `current_stock` beku
 * di angka opname terakhir, jadi kalau dipakai sebagai stok akhir hasilnya
 * "semua yang dibeli habis terpakai". Harus dilaporkan BELUM DIKETAHUI. */
describe("computeIngredientCogs — stok akhir belum dihitung", () => {
  const UNKNOWN: IngredientCogsInput = {
    ...BASE,
    // persis skenario Agustus 2026: stok akhir = current_stock = stok awal
    stockAwalQty: 905.8,
    stockAwalAvgPrice: 165,
    pembelianQty: 3_000,
    pembelianTotal: 495_000,
    stockAkhirQty: 905.8,
    stockAkhirUnknown: true,
  };

  it("tidak mengarang pemakaian — semuanya 0 + ditandai unknown", () => {
    const r = computeIngredientCogs(UNKNOWN);
    expect(r.stockAkhirUnknown).toBe(true);
    expect(r.stockAkhirQty).toBe(0);
    expect(r.stockAkhirTotal).toBe(0);
    expect(r.cogsQty).toBe(0);
    expect(r.cogsTotal).toBe(0);
    expect(r.warnings.some((w) => w.includes("belum bisa dihitung"))).toBe(
      true,
    );
  });

  it("variance ikut dinolkan supaya tidak menuduh selisih palsu", () => {
    const r = computeIngredientCogs({ ...UNKNOWN, theoreticalUsageQty: 500 });
    expect(r.actualUsageQty).toBe(0);
    expect(r.varianceQty).toBe(0);
    expect(r.variancePct).toBeNull();
    expect(r.varianceCost).toBe(0);
  });

  it("stok awal & pembelian TETAP tampil apa adanya (data nyata)", () => {
    const r = computeIngredientCogs(UNKNOWN);
    expect(r.stockAwalQty).toBe(905.8);
    expect(r.pembelianQty).toBe(3_000);
    expect(r.pembelianTotal).toBe(495_000);
  });

  it("tanpa flag, rumus lama akan bilang seluruh pembelian terpakai", () => {
    const r = computeIngredientCogs({ ...UNKNOWN, stockAkhirUnknown: false });
    // 905.8 + 3000 - 905.8 = 3000 → inilah angka palsu yang dilaporkan owner
    expect(r.cogsQty).toBe(3_000);
    expect(r.stockAkhirUnknown).toBe(false);
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

describe("computeNewWac — running average cost", () => {
  it("computes WAC from old stock + new purchase", () => {
    // 10 unit × Rp 1000 + 5 unit × Rp 1500 = 10000 + 7500 = 17500 / 15 = 1166.67
    const r = computeNewWac({
      oldQty: 10,
      oldCost: 1_000,
      purchaseQty: 5,
      purchaseTotal: 7_500,
    });
    expect(r.newCost).toBe(1_167);
    expect(r.newTotalQty).toBe(15);
    expect(r.newTotalValue).toBe(17_500);
  });

  it("first purchase ever (no old stock) → unit cost dari purchase", () => {
    const r = computeNewWac({
      oldQty: 0,
      oldCost: 0,
      purchaseQty: 100,
      purchaseTotal: 50_000,
    });
    expect(r.newCost).toBe(500);
  });

  it("clamps negative oldQty to 0 (defensive)", () => {
    // Negative stock from over-deduction shouldn't break WAC
    const r = computeNewWac({
      oldQty: -10,
      oldCost: 1_000,
      purchaseQty: 5,
      purchaseTotal: 7_500,
    });
    expect(r.effectiveOldQty).toBe(0);
    expect(r.newCost).toBe(1_500); // 7500 / 5 = 1500
  });

  it("purchaseQty=0 fallback to oldCost (no-op)", () => {
    const r = computeNewWac({
      oldQty: 10,
      oldCost: 1_000,
      purchaseQty: 0,
      purchaseTotal: 0,
    });
    expect(r.newCost).toBe(1_000);
  });

  it("rounding to integer", () => {
    // 1 × 1000 + 2 × 2000 = 5000 / 3 = 1666.67 → 1667
    const r = computeNewWac({
      oldQty: 1,
      oldCost: 1_000,
      purchaseQty: 2,
      purchaseTotal: 4_000,
    });
    expect(r.newCost).toBe(1_667);
  });

  it("price increase shifts WAC upward gradually", () => {
    // Start with 100 unit × Rp 1000 = 100k. Buy 10 more at Rp 1200 each.
    // New WAC = (100*1000 + 10*1200) / 110 = 112000/110 = 1018.18
    const r = computeNewWac({
      oldQty: 100,
      oldCost: 1_000,
      purchaseQty: 10,
      purchaseTotal: 12_000,
    });
    expect(r.newCost).toBe(1_018);
    // Not Rp 1200 (which would be overwrite-replace behavior)
    expect(r.newCost).not.toBe(1_200);
  });

  it("price decrease shifts WAC downward gradually", () => {
    // Start 100 × 1000. Buy 50 at 500. New = (100k + 25k) / 150 = 833
    const r = computeNewWac({
      oldQty: 100,
      oldCost: 1_000,
      purchaseQty: 50,
      purchaseTotal: 25_000,
    });
    expect(r.newCost).toBe(833);
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
    stockAkhirUnknown: false,
    cogsQty: 0,
    cogsAvgPrice: 0,
    cogsTotal: 0,
    theoreticalUsageQty: 0,
    theoreticalUsageCost: 0,
    actualUsageQty: 0,
    actualUsageCost: 0,
    varianceQty: 0,
    variancePct: null,
    varianceCost: 0,
    warnings: [],
    ...overrides,
  };
}
