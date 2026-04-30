import { describe, expect, it } from "vitest";
import { computeDiffStats } from "@/features/stock-opname/diff-stats";

describe("computeDiffStats", () => {
  it("returns zeros for empty input", () => {
    const s = computeDiffStats([]);
    expect(s).toEqual({
      countedLines: 0,
      totalLines: 0,
      uncountedLines: 0,
      matchingLines: 0,
      surplusLines: 0,
      shortageLines: 0,
      totalDiffQty: 0,
      totalAbsDiffQty: 0,
      totalDiffCost: 0,
      totalAbsDiffCost: 0,
    });
  });

  it("treats null actualQty as uncounted (not in any diff bucket)", () => {
    const s = computeDiffStats([
      { expectedQty: 100, actualQty: null, unitCostAtSnapshot: 50 },
      { expectedQty: 200, actualQty: null, unitCostAtSnapshot: 50 },
    ]);
    expect(s.totalLines).toBe(2);
    expect(s.countedLines).toBe(0);
    expect(s.uncountedLines).toBe(2);
    expect(s.matchingLines).toBe(0);
    expect(s.surplusLines).toBe(0);
    expect(s.shortageLines).toBe(0);
    expect(s.totalAbsDiffCost).toBe(0);
  });

  it("buckets matching/surplus/shortage correctly", () => {
    const s = computeDiffStats([
      { expectedQty: 100, actualQty: 100, unitCostAtSnapshot: 50 }, // match
      { expectedQty: 100, actualQty: 120, unitCostAtSnapshot: 50 }, // surplus +20
      { expectedQty: 100, actualQty: 80, unitCostAtSnapshot: 50 }, // shortage -20
    ]);
    expect(s.matchingLines).toBe(1);
    expect(s.surplusLines).toBe(1);
    expect(s.shortageLines).toBe(1);
    expect(s.countedLines).toBe(3);
    expect(s.totalDiffQty).toBe(0); // +20 + (-20) = 0
    expect(s.totalAbsDiffQty).toBe(40); // 0 + 20 + 20
    expect(s.totalDiffCost).toBe(0);
    expect(s.totalAbsDiffCost).toBe(2000); // 40 × 50
  });

  it("ignores unit cost on matching lines (no impact)", () => {
    const s = computeDiffStats([
      { expectedQty: 50, actualQty: 50, unitCostAtSnapshot: 9999 },
    ]);
    expect(s.totalAbsDiffCost).toBe(0);
    expect(s.matchingLines).toBe(1);
  });

  it("scales cost impact by per-line unit cost", () => {
    const s = computeDiffStats([
      { expectedQty: 0, actualQty: 5, unitCostAtSnapshot: 1000 }, // +5 × 1000 = +5000
      { expectedQty: 10, actualQty: 8, unitCostAtSnapshot: 200 }, // -2 × 200 = -400
    ]);
    expect(s.totalDiffCost).toBe(4600); // 5000 - 400
    expect(s.totalAbsDiffCost).toBe(5400);
    expect(s.surplusLines).toBe(1);
    expect(s.shortageLines).toBe(1);
  });

  it("handles a mix of counted and uncounted lines", () => {
    const s = computeDiffStats([
      { expectedQty: 100, actualQty: 100, unitCostAtSnapshot: 50 },
      { expectedQty: 100, actualQty: null, unitCostAtSnapshot: 50 },
      { expectedQty: 100, actualQty: 90, unitCostAtSnapshot: 50 },
    ]);
    expect(s.totalLines).toBe(3);
    expect(s.countedLines).toBe(2);
    expect(s.uncountedLines).toBe(1);
    expect(s.shortageLines).toBe(1);
    expect(s.matchingLines).toBe(1);
    expect(s.totalAbsDiffCost).toBe(500); // 10 × 50
  });
});
