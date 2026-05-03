import { describe, expect, it } from "vitest";
import {
  computeHppPerSection,
  type HppEstimateRowInput,
} from "@/features/stock-opname/hpp-estimate";

const baseRow: HppEstimateRowInput = {
  section: "kitchen",
  openingQty: 100,
  openingUnitCost: 50,
  purchasesCost: 1_000,
  closingQty: 80,
  closingUnitCost: 50,
};

describe("computeHppPerSection", () => {
  it("computes per-row used cost via opening + purchases - closing formula", () => {
    // opening 100 × 50 = 5_000
    // purchases = 1_000
    // closing 80 × 50 = 4_000
    // used = 5_000 + 1_000 - 4_000 = 2_000
    const { bySection, grandTotal } = computeHppPerSection([baseRow]);
    expect(bySection).toHaveLength(1);
    expect(bySection[0].section).toBe("kitchen");
    expect(bySection[0].pnlLabel).toContain("5001");
    expect(bySection[0].hppCost).toBe(2_000);
    expect(bySection[0].lineCount).toBe(1);
    expect(grandTotal).toBe(2_000);
  });

  it("treats null closing as zero (uncounted lines don't inflate the estimate)", () => {
    // opening 100 × 50 = 5_000
    // purchases = 1_000
    // closing null → 0 × 50 = 0
    // used = 5_000 + 1_000 - 0 = 6_000
    const { grandTotal } = computeHppPerSection([
      { ...baseRow, closingQty: null },
    ]);
    expect(grandTotal).toBe(6_000);
  });

  it("groups rows into the correct P&L sections", () => {
    const rows: HppEstimateRowInput[] = [
      { ...baseRow, section: "kitchen", openingQty: 10, openingUnitCost: 100, purchasesCost: 0, closingQty: 5, closingUnitCost: 100 }, // used 500
      { ...baseRow, section: "bar", openingQty: 20, openingUnitCost: 100, purchasesCost: 0, closingQty: 10, closingUnitCost: 100 }, // used 1_000
      { ...baseRow, section: "supporting", openingQty: 30, openingUnitCost: 100, purchasesCost: 0, closingQty: 20, closingUnitCost: 100 }, // used 1_000
      { ...baseRow, section: "cleaning", openingQty: 40, openingUnitCost: 100, purchasesCost: 0, closingQty: 30, closingUnitCost: 100 }, // used 1_000
    ];
    const { bySection, grandTotal } = computeHppPerSection(rows);
    expect(bySection.map((s) => s.section)).toEqual([
      "kitchen",
      "bar",
      "supporting",
      "cleaning",
    ]);
    expect(bySection.find((s) => s.section === "kitchen")!.pnlLabel).toContain(
      "5001",
    );
    expect(bySection.find((s) => s.section === "bar")!.pnlLabel).toContain(
      "5002",
    );
    expect(
      bySection.find((s) => s.section === "supporting")!.pnlLabel,
    ).toContain("5005");
    expect(bySection.find((s) => s.section === "cleaning")!.pnlLabel).toContain(
      "5006",
    );
    expect(grandTotal).toBe(3_500);
  });

  it("buckets unassigned (null section) under its own row", () => {
    const { bySection } = computeHppPerSection([
      { ...baseRow, section: null },
    ]);
    expect(bySection).toHaveLength(1);
    expect(bySection[0].section).toBeNull();
    expect(bySection[0].pnlLabel).toContain("Belum diset");
  });

  it("aggregates multiple rows in the same section", () => {
    const rows: HppEstimateRowInput[] = [
      { ...baseRow, openingQty: 10, openingUnitCost: 100, purchasesCost: 0, closingQty: 5, closingUnitCost: 100 }, // used 500
      { ...baseRow, openingQty: 20, openingUnitCost: 100, purchasesCost: 0, closingQty: 15, closingUnitCost: 100 }, // used 500
    ];
    const { bySection, grandTotal } = computeHppPerSection(rows);
    expect(bySection).toHaveLength(1);
    expect(bySection[0].lineCount).toBe(2);
    expect(bySection[0].hppCost).toBe(1_000);
    expect(grandTotal).toBe(1_000);
  });

  it("yields negative hppCost when closing exceeds opening + purchases (anomaly)", () => {
    // opening 50 × 100 = 5_000
    // purchases = 0
    // closing 80 × 100 = 8_000
    // used = 5_000 + 0 - 8_000 = -3_000
    const { bySection, grandTotal } = computeHppPerSection([
      { ...baseRow, openingQty: 50, openingUnitCost: 100, purchasesCost: 0, closingQty: 80, closingUnitCost: 100 },
    ]);
    expect(bySection[0].hppCost).toBe(-3_000);
    expect(grandTotal).toBe(-3_000);
  });

  it("returns no sections + zero total when input list is empty", () => {
    const { bySection, grandTotal } = computeHppPerSection([]);
    expect(bySection).toEqual([]);
    expect(grandTotal).toBe(0);
  });

  it("preserves section order: kitchen, bar, supporting, cleaning, unassigned", () => {
    const rows: HppEstimateRowInput[] = [
      { ...baseRow, section: "cleaning" },
      { ...baseRow, section: null },
      { ...baseRow, section: "bar" },
      { ...baseRow, section: "kitchen" },
      { ...baseRow, section: "supporting" },
    ];
    const { bySection } = computeHppPerSection(rows);
    expect(bySection.map((s) => s.section)).toEqual([
      "kitchen",
      "bar",
      "supporting",
      "cleaning",
      null,
    ]);
  });
});
