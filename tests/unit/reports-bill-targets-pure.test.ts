import { describe, expect, it } from "vitest";
import {
  BILL_BUCKET_THRESHOLDS,
  aggregateClosingShifts,
  computeBillStats,
  computeProgress,
  median,
} from "@/features/reports/bill-targets-pure";
import type { ClosingShiftRow } from "@/features/reports/types";

function shift(overrides: Partial<ClosingShiftRow>): ClosingShiftRow {
  return {
    shiftId: overrides.shiftId ?? "s1",
    shiftDate: overrides.shiftDate ?? "2026-05-14",
    openedAt: overrides.openedAt ?? "2026-05-14T01:00:00Z",
    closedAt: overrides.closedAt ?? "2026-05-14T15:00:00Z",
    durationMinutes: overrides.durationMinutes ?? 840,
    userId: overrides.userId ?? "u1",
    userName: overrides.userName ?? "Kasir",
    openingCash: overrides.openingCash ?? 200_000,
    paidCash: overrides.paidCash ?? 500_000,
    refundedCash: overrides.refundedCash ?? 0,
    expectedCash: overrides.expectedCash ?? 700_000,
    actualCash: overrides.actualCash ?? 700_000,
    variance: overrides.variance ?? 0,
    edcSettlement: overrides.edcSettlement ?? 0,
    gofoodSettlement: overrides.gofoodSettlement ?? 0,
    grabfoodSettlement: overrides.grabfoodSettlement ?? 0,
    shopeefoodSettlement: overrides.shopeefoodSettlement ?? 0,
    settlementTotal: overrides.settlementTotal ?? 0,
    notes: overrides.notes ?? null,
  };
}

describe("median", () => {
  it("returns 0 for empty array", () => {
    expect(median([])).toBe(0);
  });
  it("returns the value for single-element", () => {
    expect(median([42])).toBe(42);
  });
  it("middle for odd length", () => {
    expect(median([3, 1, 5])).toBe(3);
  });
  it("rounded average for even length", () => {
    expect(median([1, 2, 3, 4])).toBe(3);
  });
});

describe("computeBillStats", () => {
  it("returns zeros for empty input with all buckets at 0", () => {
    const { stats, buckets } = computeBillStats([]);
    expect(stats.count).toBe(0);
    expect(stats.avgBill).toBe(0);
    expect(stats.medianBill).toBe(0);
    expect(stats.modeBucket).toBeNull();
    expect(buckets).toHaveLength(BILL_BUCKET_THRESHOLDS.length);
    expect(buckets.every((b) => b.count === 0 && b.revenue === 0)).toBe(true);
  });

  it("bucket boundaries assign 50k → medium, not small", () => {
    const { buckets } = computeBillStats([49_999, 50_000, 100_000, 200_000]);
    const byKey = Object.fromEntries(buckets.map((b) => [b.key, b]));
    expect(byKey.small.count).toBe(1); // 49999
    expect(byKey.medium.count).toBe(1); // 50000
    expect(byKey.large.count).toBe(1); // 100000
    expect(byKey.premium.count).toBe(1); // 200000
  });

  it("computes avg and median correctly", () => {
    const { stats } = computeBillStats([10_000, 20_000, 30_000, 40_000, 50_000]);
    expect(stats.count).toBe(5);
    expect(stats.avgBill).toBe(30_000);
    expect(stats.medianBill).toBe(30_000);
    expect(stats.minBill).toBe(10_000);
    expect(stats.maxBill).toBe(50_000);
  });

  it("identifies modeBucket as bucket with most transactions", () => {
    // 3 small, 1 medium, 1 large
    const { stats } = computeBillStats([
      10_000, 20_000, 30_000, 75_000, 150_000,
    ]);
    expect(stats.modeBucket).toBe("small");
  });

  it("pctOfCount rounds to 1 decimal place", () => {
    const { buckets } = computeBillStats([10_000, 10_000, 60_000]);
    const small = buckets.find((b) => b.key === "small")!;
    expect(small.count).toBe(2);
    expect(small.pctOfCount).toBeCloseTo(66.7, 1);
  });
});

describe("aggregateClosingShifts", () => {
  it("returns zeros for empty input", () => {
    const agg = aggregateClosingShifts([], 5_000);
    expect(agg.shiftCount).toBe(0);
    expect(agg.totalVariance).toBe(0);
    expect(agg.avgVariance).toBe(0);
    expect(agg.overThresholdCount).toBe(0);
  });

  it("sums variance signed and finds biggest +/-", () => {
    const agg = aggregateClosingShifts(
      [
        shift({ variance: 10_000 }),
        shift({ variance: -5_000 }),
        shift({ variance: 25_000 }),
        shift({ variance: -15_000 }),
      ],
      5_000,
    );
    expect(agg.shiftCount).toBe(4);
    expect(agg.totalVariance).toBe(15_000);
    expect(agg.biggestPositiveVariance).toBe(25_000);
    expect(agg.biggestNegativeVariance).toBe(-15_000);
    expect(agg.avgVariance).toBe(3_750);
  });

  it("counts overThreshold by abs(variance) > threshold", () => {
    const agg = aggregateClosingShifts(
      [
        shift({ variance: 1_000 }),
        shift({ variance: 6_000 }),
        shift({ variance: -6_000 }),
        shift({ variance: -3_000 }),
      ],
      5_000,
    );
    expect(agg.overThresholdCount).toBe(2);
  });

  it("sums settlement and cash fields", () => {
    const agg = aggregateClosingShifts(
      [
        shift({ paidCash: 500_000, actualCash: 600_000, settlementTotal: 100_000 }),
        shift({ paidCash: 300_000, actualCash: 350_000, settlementTotal: 50_000 }),
      ],
      5_000,
    );
    expect(agg.totalPaidCash).toBe(800_000);
    expect(agg.totalActualCash).toBe(950_000);
    expect(agg.totalSettlement).toBe(150_000);
  });
});

describe("computeProgress", () => {
  it("returns no_target tier when target is null", () => {
    const r = computeProgress(500_000, null);
    expect(r.tier).toBe("no_target");
    expect(r.pct).toBeNull();
  });

  it("returns no_target when target is 0", () => {
    const r = computeProgress(500_000, 0);
    expect(r.tier).toBe("no_target");
    expect(r.pct).toBeNull();
  });

  it("on_track when pct >= 100", () => {
    const r = computeProgress(2_000_000, 2_000_000);
    expect(r.tier).toBe("on_track");
    expect(r.pct).toBe(100);
    expect(r.delta).toBe(0);
  });

  it("needs_push when 70 <= pct < 100", () => {
    const r = computeProgress(1_500_000, 2_000_000);
    expect(r.tier).toBe("needs_push");
    expect(r.pct).toBe(75);
    expect(r.delta).toBe(-500_000);
  });

  it("behind when pct < 70", () => {
    const r = computeProgress(500_000, 2_000_000);
    expect(r.tier).toBe("behind");
    expect(r.pct).toBe(25);
  });

  it("on_track for over-100 (e.g. 120%)", () => {
    const r = computeProgress(2_400_000, 2_000_000);
    expect(r.tier).toBe("on_track");
    expect(r.pct).toBe(120);
    expect(r.delta).toBe(400_000);
  });
});
