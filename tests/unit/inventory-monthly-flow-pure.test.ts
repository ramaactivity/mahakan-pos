import { describe, expect, it } from "vitest";
import {
  classifyFlowStatus,
  computeFlowTotals,
  groupRowsBySection,
} from "@/features/inventory/monthly-flow-pure";
import type { HppReportRow } from "@/features/reports";
import type { IngredientSection } from "@/features/inventory/types";

function row(overrides: Partial<HppReportRow>): HppReportRow {
  return {
    ingredientId: overrides.ingredientId ?? "ing-1",
    name: overrides.name ?? "Beras",
    unit: overrides.unit ?? "Kg",
    section: ("section" in overrides
      ? overrides.section
      : "kitchen") as IngredientSection | null,
    stockAwalQty: overrides.stockAwalQty ?? 0,
    stockAwalCost: overrides.stockAwalCost ?? 0,
    pembelianQty: overrides.pembelianQty ?? 0,
    pembelianCost: overrides.pembelianCost ?? 0,
    stockAkhirQty: overrides.stockAkhirQty ?? 0,
    stockAkhirCost: overrides.stockAkhirCost ?? 0,
    hppQty: overrides.hppQty ?? 0,
    hppCost: overrides.hppCost ?? 0,
    partial: overrides.partial ?? false,
  };
}

describe("classifyFlowStatus", () => {
  it("returns accurate when partial=false", () => {
    expect(classifyFlowStatus(row({ partial: false }))).toBe("accurate");
  });

  it("returns no_baseline when partial AND no qty data", () => {
    const status = classifyFlowStatus(
      row({ partial: true, stockAwalQty: 0, pembelianQty: 0 }),
    );
    expect(status).toBe("no_baseline");
  });

  it("returns partial when partial AND has stockAwalQty", () => {
    const status = classifyFlowStatus(
      row({ partial: true, stockAwalQty: 100, pembelianQty: 0 }),
    );
    expect(status).toBe("partial");
  });

  it("returns partial when partial AND has pembelian", () => {
    const status = classifyFlowStatus(
      row({ partial: true, stockAwalQty: 0, pembelianQty: 50 }),
    );
    expect(status).toBe("partial");
  });
});

describe("groupRowsBySection", () => {
  it("returns empty array for empty input", () => {
    expect(groupRowsBySection([])).toEqual([]);
  });

  it("groups single section into 1 group", () => {
    const r = groupRowsBySection([
      row({ ingredientId: "a", section: "kitchen", hppCost: 50_000 }),
      row({ ingredientId: "b", section: "kitchen", hppCost: 30_000 }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].section).toBe("kitchen");
    expect(r[0].rows).toHaveLength(2);
    expect(r[0].totals.hppCost).toBe(80_000);
  });

  it("preserves section order (kitchen, bar, supporting, cleaning, null last)", () => {
    const r = groupRowsBySection([
      row({ ingredientId: "x", section: null }),
      row({ ingredientId: "a", section: "cleaning" }),
      row({ ingredientId: "b", section: "kitchen" }),
      row({ ingredientId: "c", section: "supporting" }),
      row({ ingredientId: "d", section: "bar" }),
    ]);
    expect(r.map((g) => g.section)).toEqual([
      "kitchen",
      "bar",
      "supporting",
      "cleaning",
      null,
    ]);
  });

  it("null section labeled 'Belum Di-section-kan'", () => {
    const r = groupRowsBySection([row({ section: null })]);
    expect(r[0].sectionLabel).toBe("Belum Di-section-kan");
  });

  it("sums subtotals per group correctly", () => {
    const r = groupRowsBySection([
      row({
        section: "kitchen",
        stockAwalCost: 100,
        pembelianCost: 200,
        stockAkhirCost: 80,
        hppCost: 220,
      }),
      row({
        section: "bar",
        stockAwalCost: 50,
        pembelianCost: 30,
        stockAkhirCost: 20,
        hppCost: 60,
      }),
    ]);
    expect(r[0].totals.hppCost).toBe(220);
    expect(r[1].totals.hppCost).toBe(60);
  });
});

describe("computeFlowTotals", () => {
  it("returns zeros for empty input", () => {
    const t = computeFlowTotals([]);
    expect(t.rowCount).toBe(0);
    expect(t.hppCost).toBe(0);
    expect(t.partialCount).toBe(0);
  });

  it("sums all cost fields + counts rows + partialCount", () => {
    const t = computeFlowTotals([
      row({
        stockAwalCost: 100,
        pembelianCost: 200,
        stockAkhirCost: 80,
        hppCost: 220,
        partial: false,
      }),
      row({
        stockAwalCost: 50,
        pembelianCost: 30,
        stockAkhirCost: 20,
        hppCost: 60,
        partial: true,
      }),
    ]);
    expect(t.rowCount).toBe(2);
    expect(t.stockAwalCost).toBe(150);
    expect(t.pembelianCost).toBe(230);
    expect(t.stockAkhirCost).toBe(100);
    expect(t.hppCost).toBe(280);
    expect(t.partialCount).toBe(1);
  });

  it("single row passes through correctly", () => {
    const t = computeFlowTotals([
      row({ pembelianCost: 999, partial: false }),
    ]);
    expect(t.rowCount).toBe(1);
    expect(t.pembelianCost).toBe(999);
    expect(t.partialCount).toBe(0);
  });
});
