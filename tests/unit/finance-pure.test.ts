import { describe, expect, it } from "vitest";
import {
  computeCashOnHand,
  computeEdcVariance,
  computeShiftCashVariance,
  sumPayrollNetPay,
  type ShiftCashSummary,
} from "@/features/finance/finance-pure";

const closed = (
  id: string,
  openingCash: number,
  cashSales: number,
  refundedCash = 0,
): ShiftCashSummary => ({
  shiftId: id,
  status: "closed",
  openingCash,
  cashSales,
  refundedCash,
});

const open = (
  id: string,
  openingCash: number,
  cashSales: number,
  refundedCash = 0,
): ShiftCashSummary => ({
  shiftId: id,
  status: "open",
  openingCash,
  cashSales,
  refundedCash,
});

describe("computeCashOnHand", () => {
  it("zero state — no shifts, no expenses, no deposits", () => {
    const r = computeCashOnHand({
      shifts: [],
      cashExpenses: 0,
      verifiedDeposits: 0,
    });
    expect(r).toEqual({
      closedShiftsContribution: 0,
      openShiftDrawerCash: 0,
      cashOnHand: 0,
    });
  });

  it("single closed shift, no deposit", () => {
    const r = computeCashOnHand({
      shifts: [closed("s1", 500_000, 2_000_000)],
      cashExpenses: 100_000,
      verifiedDeposits: 0,
    });
    // 500_000 + 2_000_000 - 100_000 - 0 = 2_400_000
    expect(r.closedShiftsContribution).toBe(2_400_000);
    expect(r.cashOnHand).toBe(2_400_000);
    expect(r.openShiftDrawerCash).toBe(0);
  });

  it("verified deposit subtracts from cash on hand", () => {
    const r = computeCashOnHand({
      shifts: [closed("s1", 500_000, 2_000_000)],
      cashExpenses: 100_000,
      verifiedDeposits: 1_500_000,
    });
    expect(r.cashOnHand).toBe(900_000);
  });

  it("open shift cash kept separate from cash on hand", () => {
    const r = computeCashOnHand({
      shifts: [
        closed("s1", 500_000, 1_000_000),
        open("s2", 300_000, 800_000),
      ],
      cashExpenses: 0,
      verifiedDeposits: 0,
    });
    expect(r.closedShiftsContribution).toBe(1_500_000);
    expect(r.openShiftDrawerCash).toBe(1_100_000);
    expect(r.cashOnHand).toBe(1_500_000);
  });

  it("refunded cash deducts from closed contribution", () => {
    const r = computeCashOnHand({
      shifts: [closed("s1", 500_000, 1_000_000, 200_000)],
      cashExpenses: 0,
      verifiedDeposits: 0,
    });
    expect(r.closedShiftsContribution).toBe(1_300_000);
  });

  it("multiple closed shifts aggregate correctly", () => {
    const r = computeCashOnHand({
      shifts: [
        closed("s1", 500_000, 2_000_000),
        closed("s2", 500_000, 1_500_000),
        closed("s3", 500_000, 1_800_000, 50_000),
      ],
      cashExpenses: 250_000,
      verifiedDeposits: 4_000_000,
    });
    // (500k×3) + (2M+1.5M+1.8M) − 250k − 50k − 4M = 1500k + 5300k − 250k − 50k − 4000k = 2_500_000
    expect(r.cashOnHand).toBe(2_500_000);
  });

  it("over-spent (negative) is allowed — caller flags it", () => {
    const r = computeCashOnHand({
      shifts: [closed("s1", 100_000, 0)],
      cashExpenses: 0,
      verifiedDeposits: 500_000,
    });
    expect(r.cashOnHand).toBe(-400_000);
  });
});

describe("computeShiftCashVariance", () => {
  it("perfect match → variance 0", () => {
    const r = computeShiftCashVariance({
      status: "closed",
      openingCash: 500_000,
      cashSales: 1_000_000,
      cashExpenses: 100_000,
      refundedCash: 0,
      actualCash: 1_400_000,
    });
    expect(r.expected).toBe(1_400_000);
    expect(r.variance).toBe(0);
  });

  it("kasir over-counted → positive variance", () => {
    const r = computeShiftCashVariance({
      status: "closed",
      openingCash: 500_000,
      cashSales: 1_000_000,
      cashExpenses: 0,
      refundedCash: 0,
      actualCash: 1_510_000,
    });
    expect(r.variance).toBe(10_000);
  });

  it("kasir short → negative variance", () => {
    const r = computeShiftCashVariance({
      status: "closed",
      openingCash: 500_000,
      cashSales: 1_000_000,
      cashExpenses: 0,
      refundedCash: 0,
      actualCash: 1_490_000,
    });
    expect(r.variance).toBe(-10_000);
  });

  it("open shift returns null variance", () => {
    const r = computeShiftCashVariance({
      status: "open",
      openingCash: 500_000,
      cashSales: 0,
      cashExpenses: 0,
      refundedCash: 0,
      actualCash: null,
    });
    expect(r.variance).toBeNull();
    expect(r.expected).toBe(500_000);
  });

  it("refundedCash + cashExpenses both subtract", () => {
    const r = computeShiftCashVariance({
      status: "closed",
      openingCash: 500_000,
      cashSales: 2_000_000,
      cashExpenses: 150_000,
      refundedCash: 50_000,
      actualCash: 2_300_000,
    });
    expect(r.expected).toBe(2_300_000);
    expect(r.variance).toBe(0);
  });
});

describe("computeEdcVariance", () => {
  it("perfect match → 0", () => {
    const v = computeEdcVariance(
      {
        edcSettlement: 1_500_000,
        gofoodSettlement: null,
        grabfoodSettlement: null,
        shopeefoodSettlement: null,
      },
      { cardBcaActual: 1_500_000, qrisActual: 0 },
    );
    expect(v).toBe(0);
  });

  it("kasir reported more than POS recorded → positive variance", () => {
    const v = computeEdcVariance(
      {
        edcSettlement: 1_600_000,
        gofoodSettlement: null,
        grabfoodSettlement: null,
        shopeefoodSettlement: null,
      },
      { cardBcaActual: 1_500_000, qrisActual: 0 },
    );
    expect(v).toBe(100_000);
  });

  it("null reported → null variance (kasir skipped channel)", () => {
    const v = computeEdcVariance(
      {
        edcSettlement: null,
        gofoodSettlement: null,
        grabfoodSettlement: null,
        shopeefoodSettlement: null,
      },
      { cardBcaActual: 1_500_000, qrisActual: 0 },
    );
    expect(v).toBeNull();
  });
});

describe("sumPayrollNetPay", () => {
  it("empty array returns 0", () => {
    expect(sumPayrollNetPay([])).toBe(0);
  });

  it("sums all netPay values", () => {
    expect(
      sumPayrollNetPay([
        { netPay: 5_000_000 },
        { netPay: 4_500_000 },
        { netPay: 3_800_000 },
      ]),
    ).toBe(13_300_000);
  });

  it("handles zero netPay rows", () => {
    expect(
      sumPayrollNetPay([{ netPay: 5_000_000 }, { netPay: 0 }]),
    ).toBe(5_000_000);
  });
});
