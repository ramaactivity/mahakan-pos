import { describe, expect, it } from "vitest";
import {
  aggregateExpansion,
  computePrepCostFromLines,
  splitLineForMovement,
  validateNoCycle,
} from "@/features/inventory/preparation-flow-pure";

describe("computePrepCostFromLines", () => {
  it("computes single-line prep cost with waste + yield", () => {
    // 16g beans × Rp 200/g, waste 10%, yield 45ml.
    // round(16*200*1.10 / 45) = round(78.222) = 78
    expect(computePrepCostFromLines([{ qty: 16, costPerUnit: 200 }], 10, 45))
      .toBe(78);
  });

  it("computes multi-line prep cost (espresso shape, integer inputs)", () => {
    // 16g×200 + 110ml×1 = 3310, waste 10%, yield 45 → round(3310*1.10/45) = round(80.911) = 81
    expect(
      computePrepCostFromLines(
        [
          { qty: 16, costPerUnit: 200 },
          { qty: 110, costPerUnit: 1 },
        ],
        10,
        45,
      ),
    ).toBe(81);
  });

  it("zero waste short-circuits the multiplier", () => {
    // 100g × Rp 50, waste 0%, yield 100 → 100*50 / 100 = 50
    expect(computePrepCostFromLines([{ qty: 100, costPerUnit: 50 }], 0, 100))
      .toBe(50);
  });

  it("yield = 1 returns total cost (×waste)", () => {
    expect(computePrepCostFromLines([{ qty: 10, costPerUnit: 10 }], 30, 1))
      .toBe(130); // round(100 * 1.30) = 130
  });

  it("throws on yield ≤ 0", () => {
    expect(() =>
      computePrepCostFromLines([{ qty: 1, costPerUnit: 1 }], 0, 0),
    ).toThrow(/PREP_YIELD_INVALID/);
    expect(() =>
      computePrepCostFromLines([{ qty: 1, costPerUnit: 1 }], 0, -5),
    ).toThrow(/PREP_YIELD_INVALID/);
  });

  it("returns 0 for empty lines (no cost basis)", () => {
    expect(computePrepCostFromLines([], 30, 100)).toBe(0);
  });
});

describe("splitLineForMovement", () => {
  it("zero waste leaves lean intact and waste at 0", () => {
    expect(splitLineForMovement(35, 0)).toEqual({ leanQty: 35, wasteQty: 0 });
  });

  it("standard 30% waste split", () => {
    // total = round(10 * 1.30) = 13, lean = round(10) = 10, waste = 13 - 10 = 3
    expect(splitLineForMovement(10, 30)).toEqual({ leanQty: 10, wasteQty: 3 });
  });

  it("fractional raw qty rounds correctly", () => {
    // raw=12.4, waste=30 → total=round(16.12)=16, lean=round(12.4)=12, waste=4
    expect(splitLineForMovement(12.4, 30)).toEqual({
      leanQty: 12,
      wasteQty: 4,
    });
  });

  it("zero raw qty → both zero", () => {
    expect(splitLineForMovement(0, 30)).toEqual({ leanQty: 0, wasteQty: 0 });
  });

  it("negative raw qty treated as zero (defensive)", () => {
    expect(splitLineForMovement(-5, 30)).toEqual({ leanQty: 0, wasteQty: 0 });
  });

  it("convention check: lean + waste = total over a sweep", () => {
    for (let raw = 1; raw <= 50; raw++) {
      for (const w of [0, 5, 10, 30, 100]) {
        const { leanQty, wasteQty } = splitLineForMovement(raw, w);
        const expectedTotal = Math.round(raw * (1 + w / 100));
        expect(leanQty + wasteQty).toBe(expectedTotal);
      }
    }
  });
});

describe("aggregateExpansion", () => {
  it("sums same ingredient across two paths before rounding", () => {
    // 12.4 + 0.3 = 12.7 → round = 13 (NOT round(12.4) + round(0.3) = 12)
    const result = aggregateExpansion([
      { ingredientId: "A", qtyScaled: 12.4 },
      { ingredientId: "A", qtyScaled: 0.3 },
    ]);
    expect(result.get("A")).toBe(13);
  });

  it("rounds single fractional value", () => {
    const result = aggregateExpansion([
      { ingredientId: "A", qtyScaled: 12.444 },
    ]);
    expect(result.get("A")).toBe(12);
  });

  it("preserves multiple ingredients independently", () => {
    const result = aggregateExpansion([
      { ingredientId: "A", qtyScaled: 1.4 },
      { ingredientId: "B", qtyScaled: 2.6 },
      { ingredientId: "A", qtyScaled: 0.7 },
    ]);
    expect(result.get("A")).toBe(2); // round(2.1) = 2
    expect(result.get("B")).toBe(3);
    expect(result.size).toBe(2);
  });

  it("empty input → empty map", () => {
    expect(aggregateExpansion([]).size).toBe(0);
  });
});

describe("validateNoCycle", () => {
  it("returns false when graph is empty and no self-reference", () => {
    expect(validateNoCycle(new Map(), "P1", ["A", "B"])).toBe(false);
  });

  it("returns true on self-reference (P references itself)", () => {
    expect(validateNoCycle(new Map(), "P1", ["P1", "A"])).toBe(true);
  });

  it("detects indirect cycle: P1 → Q → P1", () => {
    // Q already references P1 in adjacency. We propose P1 to use Q.
    const adj = new Map<string, string[]>([["Q", ["P1"]]]);
    expect(validateNoCycle(adj, "P1", ["Q"])).toBe(true);
  });

  it("detects deep chain cycle: P1 → A → B → P1", () => {
    const adj = new Map<string, string[]>([
      ["A", ["B"]],
      ["B", ["P1"]],
    ]);
    expect(validateNoCycle(adj, "P1", ["A"])).toBe(true);
  });

  it("does not flag diamond dependency as cycle", () => {
    // P1 → [A_prep, B_prep] both → X_atomic. X has no recipe (atomic).
    const adj = new Map<string, string[]>([
      ["A", ["X"]],
      ["B", ["X"]],
    ]);
    expect(validateNoCycle(adj, "P1", ["A", "B"])).toBe(false);
  });

  it("does not flag unrelated graph as cycle", () => {
    const adj = new Map<string, string[]>([
      ["Q", ["R"]],
      ["R", ["S"]],
    ]);
    expect(validateNoCycle(adj, "P1", ["Q"])).toBe(false);
  });

  it("excluded recipe (caller-side filter) does not appear in adjacency", () => {
    // Caller responsibility: if editing P1's recipe, do not include P1's
    // current ingredients in adjacency. This test simulates the post-filter
    // adjacency — no edge from P1, so no cycle.
    const adj = new Map<string, string[]>([
      ["Q", ["A"]],
    ]);
    expect(validateNoCycle(adj, "P1", ["Q"])).toBe(false);
  });
});
