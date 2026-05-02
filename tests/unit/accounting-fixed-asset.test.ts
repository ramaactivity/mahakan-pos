import { describe, it, expect } from "vitest";
import {
  computeMonthlyDepreciation,
  mapCapitalizeAsset,
  mapMonthlyDepreciation,
} from "@/features/accounting/mapping";

function sumDr(lines: Array<{ debit?: number; credit?: number }>) {
  return lines.reduce((s, l) => s + (l.debit ?? 0), 0);
}
function sumCr(lines: Array<{ debit?: number; credit?: number }>) {
  return lines.reduce((s, l) => s + (l.credit ?? 0), 0);
}

// ============================================================
// computeMonthlyDepreciation
// ============================================================

describe("computeMonthlyDepreciation", () => {
  it("simple straight-line: 60-month, no salvage", () => {
    // Cost 6jt, useful 60 bulan, salvage 0 → 100k per bulan
    expect(
      computeMonthlyDepreciation({
        cost: 6_000_000,
        salvageValue: 0,
        usefulLifeMonths: 60,
        monthIndex: 1,
      }),
    ).toBe(100_000);
    expect(
      computeMonthlyDepreciation({
        cost: 6_000_000,
        salvageValue: 0,
        usefulLifeMonths: 60,
        monthIndex: 30,
      }),
    ).toBe(100_000);
  });

  it("with salvage value", () => {
    // Cost 7jt salvage 1jt useful 60 → (7-1)/60 = 100k per bulan
    expect(
      computeMonthlyDepreciation({
        cost: 7_000_000,
        salvageValue: 1_000_000,
        usefulLifeMonths: 60,
        monthIndex: 5,
      }),
    ).toBe(100_000);
  });

  it("last month catch-up handles rounding leftover", () => {
    // Cost 1000, useful 3, salvage 0 → floor(1000/3)=333 per bulan
    // Bulan 1: 333, Bulan 2: 333, Bulan 3: 1000-333*2 = 334 (catches the 1)
    expect(
      computeMonthlyDepreciation({
        cost: 1000,
        salvageValue: 0,
        usefulLifeMonths: 3,
        monthIndex: 1,
      }),
    ).toBe(333);
    expect(
      computeMonthlyDepreciation({
        cost: 1000,
        salvageValue: 0,
        usefulLifeMonths: 3,
        monthIndex: 3,
      }),
    ).toBe(334);
    // Sum: 333 + 333 + 334 = 1000 ✓
  });

  it("returns 0 saat monthIndex < 1", () => {
    expect(
      computeMonthlyDepreciation({
        cost: 1000,
        salvageValue: 0,
        usefulLifeMonths: 12,
        monthIndex: 0,
      }),
    ).toBe(0);
  });

  it("returns 0 saat monthIndex > useful life (fully depreciated)", () => {
    expect(
      computeMonthlyDepreciation({
        cost: 1000,
        salvageValue: 0,
        usefulLifeMonths: 12,
        monthIndex: 13,
      }),
    ).toBe(0);
  });

  it("returns 0 kalau salvage >= cost", () => {
    expect(
      computeMonthlyDepreciation({
        cost: 1000,
        salvageValue: 1000,
        usefulLifeMonths: 12,
        monthIndex: 5,
      }),
    ).toBe(0);
  });

  it("cumulative dep = cost - salvage exactly (rounding-safe)", () => {
    const cost = 5_500_000;
    const salvage = 250_000;
    const life = 24;
    let total = 0;
    for (let i = 1; i <= life; i++) {
      total += computeMonthlyDepreciation({
        cost,
        salvageValue: salvage,
        usefulLifeMonths: life,
        monthIndex: i,
      });
    }
    expect(total).toBe(cost - salvage);
  });
});

// ============================================================
// mapCapitalizeAsset
// ============================================================

describe("mapCapitalizeAsset", () => {
  const base = {
    assetId: "a1",
    assetName: "Test Asset",
    outletId: "o1",
    entryDate: "2026-06-01",
    cost: 10_000_000,
    assetAccountCode: "1202",
  };

  it("cash payment → Dr asset Cr 1101", () => {
    const lines = mapCapitalizeAsset({ ...base, paymentMethod: "cash" });
    expect(sumDr(lines)).toBe(sumCr(lines));
    expect(lines.find((l) => l.accountCode === "1202")?.debit).toBe(10_000_000);
    expect(lines.find((l) => l.accountCode === "1101")?.credit).toBe(10_000_000);
  });

  it("transfer_bca → Cr 1110", () => {
    const lines = mapCapitalizeAsset({ ...base, paymentMethod: "transfer_bca" });
    expect(lines.find((l) => l.accountCode === "1110")?.credit).toBe(10_000_000);
  });

  it("transfer_bri → Cr 1111", () => {
    const lines = mapCapitalizeAsset({ ...base, paymentMethod: "transfer_bri" });
    expect(lines.find((l) => l.accountCode === "1111")?.credit).toBe(10_000_000);
  });

  it("zero throws", () => {
    expect(() =>
      mapCapitalizeAsset({ ...base, cost: 0, paymentMethod: "cash" }),
    ).toThrow();
  });
});

// ============================================================
// mapMonthlyDepreciation
// ============================================================

describe("mapMonthlyDepreciation", () => {
  const baseAsset = (
    cost: number,
    depCode: string,
    monthIndex = 1,
    usefulLife = 60,
  ) => ({
    assetId: `a-${cost}`,
    assetName: `Asset ${cost}`,
    cost,
    salvageValue: 0,
    usefulLifeMonths: usefulLife,
    depreciationAccountCode: depCode,
    accumulatedDepreciationAccountCode: "1290",
    monthIndex,
  });

  it("single asset → Dr 6501 Cr 1290", () => {
    const lines = mapMonthlyDepreciation({
      outletId: "o1",
      periodFirstDay: "2026-06-01",
      periodLabel: "Juni 2026",
      assets: [baseAsset(6_000_000, "6501")],
    });
    expect(sumDr(lines)).toBe(sumCr(lines));
    expect(lines.find((l) => l.accountCode === "6501")?.debit).toBe(100_000);
    expect(lines.find((l) => l.accountCode === "1290")?.credit).toBe(100_000);
  });

  it("multiple assets same dep account aggregate", () => {
    const lines = mapMonthlyDepreciation({
      outletId: "o1",
      periodFirstDay: "2026-06-01",
      periodLabel: "Juni 2026",
      assets: [
        baseAsset(6_000_000, "6501"), // 100k/bulan
        baseAsset(12_000_000, "6501"), // 200k/bulan
      ],
    });
    expect(sumDr(lines)).toBe(sumCr(lines));
    // 1 line Dr 6501 = 300k, 1 line Cr 1290 = 300k
    expect(lines.length).toBe(2);
    expect(lines.find((l) => l.accountCode === "6501")?.debit).toBe(300_000);
    expect(lines.find((l) => l.accountCode === "1290")?.credit).toBe(300_000);
  });

  it("multiple dep accounts kept separate, accum aggregated", () => {
    const lines = mapMonthlyDepreciation({
      outletId: "o1",
      periodFirstDay: "2026-06-01",
      periodLabel: "Juni 2026",
      assets: [
        baseAsset(6_000_000, "6501"), // furniture 100k
        baseAsset(12_000_000, "6502"), // dapur 200k
      ],
    });
    expect(sumDr(lines)).toBe(sumCr(lines));
    expect(lines.find((l) => l.accountCode === "6501")?.debit).toBe(100_000);
    expect(lines.find((l) => l.accountCode === "6502")?.debit).toBe(200_000);
    expect(lines.find((l) => l.accountCode === "1290")?.credit).toBe(300_000);
  });

  it("asset di luar useful life di-skip (returns 0)", () => {
    const lines = mapMonthlyDepreciation({
      outletId: "o1",
      periodFirstDay: "2026-06-01",
      periodLabel: "Juni 2026",
      assets: [
        baseAsset(6_000_000, "6501", 1), // bulan 1, 100k
        baseAsset(6_000_000, "6502", 61, 60), // bulan 61 di luar life
      ],
    });
    expect(sumDr(lines)).toBe(sumCr(lines));
    expect(lines.find((l) => l.accountCode === "6502")).toBeUndefined();
  });

  it("all assets fully depreciated → empty array", () => {
    const lines = mapMonthlyDepreciation({
      outletId: "o1",
      periodFirstDay: "2026-06-01",
      periodLabel: "Juni 2026",
      assets: [baseAsset(6_000_000, "6501", 100, 60)],
    });
    expect(lines).toEqual([]);
  });

  it("last month catch-up reflected in journal", () => {
    const lines = mapMonthlyDepreciation({
      outletId: "o1",
      periodFirstDay: "2026-06-01",
      periodLabel: "Juni 2026",
      assets: [
        {
          assetId: "a1",
          assetName: "Test",
          cost: 1000,
          salvageValue: 0,
          usefulLifeMonths: 3,
          depreciationAccountCode: "6501",
          accumulatedDepreciationAccountCode: "1290",
          monthIndex: 3, // last month
        },
      ],
    });
    // Last month value 334 (catches rounding)
    expect(lines.find((l) => l.accountCode === "6501")?.debit).toBe(334);
    expect(lines.find((l) => l.accountCode === "1290")?.credit).toBe(334);
  });
});
