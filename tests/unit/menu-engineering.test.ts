import { describe, expect, it } from "vitest";
import {
  MENU_ENGINEERING_MIN_ITEMS,
  classifyMenuMatrix,
  linearMedian,
} from "@/features/reports/menu-engineering-pure";
import type { ItemPerformanceRow } from "@/features/reports/types";

function row(overrides: Partial<ItemPerformanceRow>): ItemPerformanceRow {
  return {
    menuItemId: overrides.menuItemId ?? `id-${Math.random().toString(36).slice(2, 8)}`,
    name: overrides.name ?? "Item",
    categoryName: overrides.categoryName ?? "Cat",
    quantity: overrides.quantity ?? 0,
    revenue: overrides.revenue ?? 0,
    averageOrderValue: overrides.averageOrderValue ?? 0,
    cogs: overrides.cogs ?? null,
    marginPct: overrides.marginPct ?? null,
  };
}

describe("linearMedian", () => {
  it("returns null for empty array", () => {
    expect(linearMedian([])).toBeNull();
  });

  it("returns the only value for single-element array", () => {
    expect(linearMedian([42])).toBe(42);
  });

  it("returns the middle value for odd-length sorted input", () => {
    expect(linearMedian([1, 5, 10])).toBe(5);
  });

  it("returns linear interpolation for even-length input", () => {
    expect(linearMedian([1, 2, 3, 4])).toBe(2.5);
  });

  it("handles unsorted input", () => {
    expect(linearMedian([10, 1, 5, 3])).toBe(4);
  });

  it("handles all-same values", () => {
    expect(linearMedian([7, 7, 7, 7])).toBe(7);
  });
});

describe("classifyMenuMatrix", () => {
  it("returns unclassified when fewer than MIN_ITEMS classifiable", () => {
    const rows = [
      row({ name: "A", quantity: 10, revenue: 50_000, cogs: 20_000 }),
      row({ name: "B", quantity: 5, revenue: 20_000, cogs: 10_000 }),
      row({ name: "C", quantity: 0, revenue: 0, cogs: 0 }), // not classifiable
    ];
    const result = classifyMenuMatrix(rows);
    expect(result.classified).toBe(false);
    expect(result.medianQty).toBeNull();
    expect(result.medianContribMargin).toBeNull();
    expect(result.counts.unclassified).toBe(3);
    expect(result.rows.every((r) => r.quadrant === "unclassified")).toBe(true);
  });

  it("excludes rows with null cogs from classification but keeps them in result", () => {
    const rows = [
      row({ name: "A", quantity: 10, revenue: 50_000, cogs: 20_000 }),
      row({ name: "B", quantity: 8, revenue: 30_000, cogs: 15_000 }),
      row({ name: "C", quantity: 6, revenue: 40_000, cogs: 10_000 }),
      row({ name: "D", quantity: 4, revenue: 20_000, cogs: 8_000 }),
      row({ name: "NoCogs", quantity: 12, revenue: 60_000, cogs: null }),
    ];
    const result = classifyMenuMatrix(rows);
    expect(result.classified).toBe(true);
    expect(result.rows).toHaveLength(5);
    const noCogs = result.rows.find((r) => r.name === "NoCogs");
    expect(noCogs?.quadrant).toBe("unclassified");
    expect(noCogs?.contribMarginRp).toBeNull();
  });

  it("classifies 4-item set into 4 distinct quadrants by median split", () => {
    // Construct so that medians cleanly split 2 vs 2 on each axis
    const rows = [
      // qty=10, contribMargin = 50k-10k=40k (high pop, high margin) → STAR
      row({ name: "Star", quantity: 10, revenue: 50_000, cogs: 10_000 }),
      // qty=10, contribMargin = 30k-25k=5k (high pop, low margin) → PLOWHORSE
      row({ name: "Plowhorse", quantity: 10, revenue: 30_000, cogs: 25_000 }),
      // qty=2, contribMargin = 50k-10k=40k (low pop, high margin) → PUZZLE
      row({ name: "Puzzle", quantity: 2, revenue: 50_000, cogs: 10_000 }),
      // qty=2, contribMargin = 30k-25k=5k (low pop, low margin) → DOG
      row({ name: "Dog", quantity: 2, revenue: 30_000, cogs: 25_000 }),
    ];
    const result = classifyMenuMatrix(rows);
    expect(result.classified).toBe(true);
    expect(result.medianQty).toBe(6); // (2+10)/2 by linear interp on [2,2,10,10] = (2+10)/2 = 6
    expect(result.medianContribMargin).toBe(22500); // (5000+40000)/2

    const byName = Object.fromEntries(result.rows.map((r) => [r.name, r.quadrant]));
    expect(byName.Star).toBe("star");
    expect(byName.Plowhorse).toBe("plowhorse");
    expect(byName.Puzzle).toBe("puzzle");
    expect(byName.Dog).toBe("dog");

    expect(result.counts).toMatchObject({
      star: 1,
      plowhorse: 1,
      puzzle: 1,
      dog: 1,
      unclassified: 0,
    });
  });

  it("ties at median go UP (≥ median = high)", () => {
    // 4 items with qty=5, all classifiable, distinct margins
    const rows = [
      row({ name: "A", quantity: 5, revenue: 100_000, cogs: 10_000 }), // 90k
      row({ name: "B", quantity: 5, revenue: 80_000, cogs: 10_000 }),  // 70k
      row({ name: "C", quantity: 5, revenue: 60_000, cogs: 10_000 }),  // 50k
      row({ name: "D", quantity: 5, revenue: 40_000, cogs: 10_000 }),  // 30k
    ];
    const result = classifyMenuMatrix(rows);
    expect(result.medianQty).toBe(5);
    expect(result.medianContribMargin).toBe(60000); // (50k+70k)/2
    // All qty=5 → all "high pop". Margin split:
    //   A=90k >=60k → high → STAR
    //   B=70k >=60k → high → STAR
    //   C=50k <60k  → low  → PLOWHORSE
    //   D=30k <60k  → low  → PLOWHORSE
    const byName = Object.fromEntries(result.rows.map((r) => [r.name, r.quadrant]));
    expect(byName.A).toBe("star");
    expect(byName.B).toBe("star");
    expect(byName.C).toBe("plowhorse");
    expect(byName.D).toBe("plowhorse");
  });

  it("computes totals across ALL rows including unclassified", () => {
    const rows = [
      row({ name: "A", quantity: 10, revenue: 50_000, cogs: 20_000 }),
      row({ name: "B", quantity: 5, revenue: 25_000, cogs: 10_000 }),
      row({ name: "C", quantity: 3, revenue: 15_000, cogs: 5_000 }),
      row({ name: "D", quantity: 2, revenue: 10_000, cogs: 2_000 }),
      row({ name: "NoCogs", quantity: 8, revenue: 40_000, cogs: null }),
      row({ name: "NoSales", quantity: 0, revenue: 0, cogs: null }),
    ];
    const result = classifyMenuMatrix(rows);
    expect(result.totals.revenue).toBe(140_000); // sum all 6 rows
    expect(result.totals.cogs).toBe(37_000); // sum 4 with cogs
    expect(result.totals.contribMargin).toBe(63_000); // (50-20)+(25-10)+(15-5)+(10-2) = 30+15+10+8
  });

  it("handles 5 items with mixed classification", () => {
    const rows = [
      row({ name: "Best", quantity: 100, revenue: 1_000_000, cogs: 100_000 }), // 900k margin
      row({ name: "Mid1", quantity: 50, revenue: 500_000, cogs: 200_000 }),    // 300k
      row({ name: "Mid2", quantity: 40, revenue: 400_000, cogs: 150_000 }),    // 250k
      row({ name: "Mid3", quantity: 30, revenue: 300_000, cogs: 200_000 }),    // 100k
      row({ name: "Low", quantity: 5, revenue: 50_000, cogs: 30_000 }),        // 20k
    ];
    const result = classifyMenuMatrix(rows);
    expect(result.classified).toBe(true);
    // 5 items: medianQty = sorted([5,30,40,50,100])[2] = 40
    // medianContribMargin = sorted([20k,100k,250k,300k,900k])[2] = 250k
    expect(result.medianQty).toBe(40);
    expect(result.medianContribMargin).toBe(250_000);
    const byName = Object.fromEntries(result.rows.map((r) => [r.name, r.quadrant]));
    expect(byName.Best).toBe("star"); // 100>=40, 900k>=250k
    expect(byName.Mid1).toBe("star"); // 50>=40, 300k>=250k
    expect(byName.Mid2).toBe("star"); // 40>=40, 250k>=250k (ties UP)
    expect(byName.Mid3).toBe("dog"); // 30<40, 100k<250k
    expect(byName.Low).toBe("dog"); // 5<40, 20k<250k
  });

  it("MIN_ITEMS guard at exactly 4 — classify (boundary)", () => {
    expect(MENU_ENGINEERING_MIN_ITEMS).toBe(4);
    const rows = Array.from({ length: 4 }, (_, i) =>
      row({ name: `M${i}`, quantity: i + 1, revenue: 10_000 * (i + 1), cogs: 1_000 }),
    );
    const result = classifyMenuMatrix(rows);
    expect(result.classified).toBe(true);
  });

  it("MIN_ITEMS guard at 3 — unclassified", () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      row({ name: `M${i}`, quantity: i + 1, revenue: 10_000 * (i + 1), cogs: 1_000 }),
    );
    const result = classifyMenuMatrix(rows);
    expect(result.classified).toBe(false);
  });

  it("preserves all row order in output", () => {
    const names = ["Z", "A", "M", "B", "Y"];
    const rows = names.map((name, i) =>
      row({ name, quantity: 10 + i, revenue: 50_000, cogs: 10_000 }),
    );
    const result = classifyMenuMatrix(rows);
    expect(result.rows.map((r) => r.name)).toEqual(names);
  });
});
