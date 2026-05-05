import { describe, it, expect } from "vitest";
import {
  aggregateByCategory,
  isPiutangChannel,
  mapAggregatorSettlement,
  mapCashDepositVerified,
  mapCategoryToAccounts,
  mapPayrollPaid,
  mapPosCompliment,
  mapPosRefund,
  mapPosSale,
  mapShiftVariance,
  piutangCodeForChannel,
  resolveBankCodeFromDestination,
} from "@/features/accounting/mapping";

function sumDebit(lines: Array<{ debit?: number; credit?: number }>) {
  return lines.reduce((s, l) => s + (l.debit ?? 0), 0);
}
function sumCredit(lines: Array<{ debit?: number; credit?: number }>) {
  return lines.reduce((s, l) => s + (l.credit ?? 0), 0);
}
function isBalanced(lines: Array<{ debit?: number; credit?: number }>) {
  return sumDebit(lines) === sumCredit(lines);
}

// ============================================================
// categoryMapper
// ============================================================

describe("mapCategoryToAccounts", () => {
  it("food keywords route to 4101/5101/1140", () => {
    const m = mapCategoryToAccounts("Ricebowl");
    expect(m.bucket).toBe("food");
    expect(m.revenueAccountCode).toBe("4101");
    expect(m.cogsAccountCode).toBe("5101");
    expect(m.persediaanAccountCode).toBe("1140");
  });

  it("Bakmie + Snack also food", () => {
    expect(mapCategoryToAccounts("Bakmie").bucket).toBe("food");
    expect(mapCategoryToAccounts("Snack").bucket).toBe("food");
    expect(mapCategoryToAccounts("Croffle").bucket).toBe("food");
  });

  it("drink keywords route to 4102/5102/1141", () => {
    const m = mapCategoryToAccounts("Coffee Based");
    expect(m.bucket).toBe("drink");
    expect(m.revenueAccountCode).toBe("4102");
    expect(m.cogsAccountCode).toBe("5102");
    expect(m.persediaanAccountCode).toBe("1141");
  });

  it("Manual Brew + Non-Coffee + Tea also drink", () => {
    expect(mapCategoryToAccounts("Manual Brew").bucket).toBe("drink");
    expect(mapCategoryToAccounts("Non-Coffee").bucket).toBe("drink");
    expect(mapCategoryToAccounts("Tea Selection").bucket).toBe("drink");
  });

  it("unknown category falls back to other (4103/5103/1142)", () => {
    const m = mapCategoryToAccounts("Merchandise");
    expect(m.bucket).toBe("other");
    expect(m.revenueAccountCode).toBe("4103");
  });

  it("aggregateByCategory sums correctly per bucket", () => {
    const result = aggregateByCategory([
      { itemCategoryName: "Ricebowl", amount: 50000, cogs: 15000 },
      { itemCategoryName: "Coffee Based", amount: 30000, cogs: 8000 },
      { itemCategoryName: "Bakmie", amount: 40000, cogs: 12000 },
    ]);
    expect(result.food.amount).toBe(90000); // 50k + 40k
    expect(result.food.cogs).toBe(27000);
    expect(result.drink.amount).toBe(30000);
    expect(result.drink.cogs).toBe(8000);
    expect(result.other.amount).toBe(0);
  });
});

// ============================================================
// mapPosSale
// ============================================================

describe("mapPosSale", () => {
  const baseInput = {
    transactionId: "trx-1",
    transactionNumber: "TRX-20260601-0001",
    outletId: "outlet-1",
    entryDate: "2026-06-01",
  };

  it("cash sale single category balanced + correct accounts", () => {
    const lines = mapPosSale({
      ...baseInput,
      paymentMethod: "cash",
      total: 50000,
      subtotal: 50000,
      discountAmount: 0,
      items: [
        { itemCategoryName: "Coffee Based", amount: 50000, cogs: 12000 },
      ],
    });
    expect(isBalanced(lines)).toBe(true);
    // Dr 1101 50k, Cr 4102 50k, Dr 5102 12k, Cr 1141 12k
    expect(lines.find((l) => l.accountCode === "1101")?.debit).toBe(50000);
    expect(lines.find((l) => l.accountCode === "4102")?.credit).toBe(50000);
    expect(lines.find((l) => l.accountCode === "5102")?.debit).toBe(12000);
    expect(lines.find((l) => l.accountCode === "1141")?.credit).toBe(12000);
  });

  it("cash sale with discount → 4110 kontra debit", () => {
    const lines = mapPosSale({
      ...baseInput,
      paymentMethod: "cash",
      total: 45000,
      subtotal: 50000,
      discountAmount: 5000,
      items: [{ itemCategoryName: "Coffee", amount: 50000, cogs: 0 }],
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "4110")?.debit).toBe(5000);
    expect(lines.find((l) => l.accountCode === "1101")?.debit).toBe(45000);
    // Revenue Cr tetap gross 50k
    expect(lines.find((l) => l.accountCode === "4102")?.credit).toBe(50000);
  });

  it("qris sale routes ke 1120 piutang", () => {
    const lines = mapPosSale({
      ...baseInput,
      paymentMethod: "qris",
      total: 30000,
      subtotal: 30000,
      discountAmount: 0,
      items: [{ itemCategoryName: "Bakmie", amount: 30000, cogs: 8000 }],
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "1120")?.debit).toBe(30000);
  });

  it("split payment balances + lines per method", () => {
    const lines = mapPosSale({
      ...baseInput,
      paymentMethod: "split",
      total: 100000,
      subtotal: 100000,
      discountAmount: 0,
      items: [
        { itemCategoryName: "Ricebowl", amount: 60000, cogs: 18000 },
        { itemCategoryName: "Coffee", amount: 40000, cogs: 10000 },
      ],
      splits: [
        { paymentMethod: "cash", amount: 50000 },
        { paymentMethod: "qris", amount: 50000 },
      ],
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "1101")?.debit).toBe(50000);
    expect(lines.find((l) => l.accountCode === "1120")?.debit).toBe(50000);
  });

  it("split mismatch throws", () => {
    expect(() =>
      mapPosSale({
        ...baseInput,
        paymentMethod: "split",
        total: 100000,
        subtotal: 100000,
        discountAmount: 0,
        items: [{ itemCategoryName: "Coffee", amount: 100000, cogs: 0 }],
        splits: [{ paymentMethod: "cash", amount: 90000 }],
      }),
    ).toThrow(/MAP_POS_SALE_SPLIT_MISMATCH/);
  });

  it("no cogs items → no COGS lines (recipe missing)", () => {
    const lines = mapPosSale({
      ...baseInput,
      paymentMethod: "cash",
      total: 50000,
      subtotal: 50000,
      discountAmount: 0,
      items: [{ itemCategoryName: "Coffee", amount: 50000, cogs: 0 }],
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "5102")).toBeUndefined();
    expect(lines.find((l) => l.accountCode === "1141")).toBeUndefined();
  });
});

// ============================================================
// mapPosRefund
// ============================================================

describe("mapPosRefund", () => {
  const base = {
    transactionId: "trx-1",
    transactionNumber: "TRX-20260601-0001",
    outletId: "outlet-1",
    entryDate: "2026-06-02",
  };

  it("full refund cash → balanced 4111+1101", () => {
    const lines = mapPosRefund({
      ...base,
      originalPaymentMethod: "cash",
      refundedAmount: 50000,
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "4111")?.debit).toBe(50000);
    expect(lines.find((l) => l.accountCode === "1101")?.credit).toBe(50000);
  });

  it("refund qris routes ke 1120", () => {
    const lines = mapPosRefund({
      ...base,
      originalPaymentMethod: "qris",
      refundedAmount: 30000,
    });
    expect(lines.find((l) => l.accountCode === "1120")?.credit).toBe(30000);
  });

  it("split refund follows split breakdown", () => {
    const lines = mapPosRefund({
      ...base,
      originalPaymentMethod: "split",
      refundedAmount: 100000,
      splits: [
        { paymentMethod: "cash", amount: 50000 },
        { paymentMethod: "qris", amount: 50000 },
      ],
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "1101")?.credit).toBe(50000);
    expect(lines.find((l) => l.accountCode === "1120")?.credit).toBe(50000);
  });

  it("reverseCogs adds Dr Persediaan + Cr HPP per bucket", () => {
    const lines = mapPosRefund({
      ...base,
      originalPaymentMethod: "cash",
      refundedAmount: 50000,
      items: [{ itemCategoryName: "Coffee", amount: 50000, cogs: 12000 }],
      reverseCogs: true,
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "1141")?.debit).toBe(12000);
    expect(lines.find((l) => l.accountCode === "5102")?.credit).toBe(12000);
  });

  it("reverseCogs OFF (default) → no persediaan reversal", () => {
    const lines = mapPosRefund({
      ...base,
      originalPaymentMethod: "cash",
      refundedAmount: 50000,
      items: [{ itemCategoryName: "Coffee", amount: 50000, cogs: 12000 }],
    });
    expect(lines.find((l) => l.accountCode === "1141")).toBeUndefined();
  });
});

// ============================================================
// mapPosCompliment
// ============================================================

describe("mapPosCompliment", () => {
  const base = {
    transactionId: "trx-1",
    transactionNumber: "TRX-20260601-0001",
    outletId: "outlet-1",
    entryDate: "2026-06-01",
  };

  it("compliment with COGS → Dr 6304 + Cr persediaan per bucket balanced", () => {
    const lines = mapPosCompliment({
      ...base,
      items: [
        { itemCategoryName: "Coffee", amount: 0, cogs: 8000 },
        { itemCategoryName: "Croffle", amount: 0, cogs: 7000 },
      ],
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "6304")?.debit).toBe(15000);
    expect(lines.find((l) => l.accountCode === "1141")?.credit).toBe(8000); // bar (coffee)
    expect(lines.find((l) => l.accountCode === "1140")?.credit).toBe(7000); // kitchen (croffle)
  });

  it("compliment without COGS returns empty array (Owner-confirmed Q6)", () => {
    const lines = mapPosCompliment({
      ...base,
      items: [{ itemCategoryName: "Coffee", amount: 0, cogs: 0 }],
    });
    expect(lines).toEqual([]);
  });
});

// ============================================================
// mapPayrollPaid
// ============================================================

describe("mapPayrollPaid", () => {
  it("transfer base-only → Dr 6101 Cr 1110", () => {
    const lines = mapPayrollPaid({
      payrollPeriodId: "p-1",
      periodLabel: "Mei 2026",
      outletId: "outlet-1",
      entryDate: "2026-05-31",
      totalBaseSalary: 5_000_000,
      totalOvertimePay: 0,
      totalBonus: 0,
      totalDeductions: 0,
      totalNetPay: 5_000_000,
      paymentMethod: "transfer",
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "6101")?.debit).toBe(5000000);
    expect(lines.find((l) => l.accountCode === "1110")?.credit).toBe(5000000);
  });

  it("cash base-only → Cr 1101 instead of 1110", () => {
    const lines = mapPayrollPaid({
      payrollPeriodId: "p-2",
      periodLabel: "Apr 2026",
      outletId: "outlet-1",
      entryDate: "2026-04-30",
      totalBaseSalary: 1_000_000,
      totalOvertimePay: 0,
      totalBonus: 0,
      totalDeductions: 0,
      totalNetPay: 1_000_000,
      paymentMethod: "cash",
    });
    expect(lines.find((l) => l.accountCode === "1101")?.credit).toBe(1000000);
  });

  it("full breakdown → emits 5 lines balanced (Dr 6101/6103/6102, Cr 6105/1110)", () => {
    const lines = mapPayrollPaid({
      payrollPeriodId: "p-4",
      periodLabel: "Jun 2026",
      outletId: "outlet-1",
      entryDate: "2026-06-30",
      totalBaseSalary: 5_000_000,
      totalOvertimePay: 800_000,
      totalBonus: 300_000,
      totalDeductions: 100_000,
      totalNetPay: 6_000_000, // 5M + 800k + 300k - 100k
      paymentMethod: "transfer",
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines).toHaveLength(5);
    expect(lines.find((l) => l.accountCode === "6101")?.debit).toBe(5_000_000);
    expect(lines.find((l) => l.accountCode === "6103")?.debit).toBe(800_000);
    expect(lines.find((l) => l.accountCode === "6102")?.debit).toBe(300_000);
    expect(lines.find((l) => l.accountCode === "6105")?.credit).toBe(100_000);
    expect(lines.find((l) => l.accountCode === "1110")?.credit).toBe(6_000_000);
  });

  it("breakdown sum mismatch with netPay → throws", () => {
    expect(() =>
      mapPayrollPaid({
        payrollPeriodId: "p-5",
        periodLabel: "Test",
        outletId: "outlet-1",
        entryDate: "2026-06-30",
        totalBaseSalary: 5_000_000,
        totalOvertimePay: 0,
        totalBonus: 0,
        totalDeductions: 0,
        totalNetPay: 4_000_000, // mismatch (expected 5M)
        paymentMethod: "transfer",
      }),
    ).toThrow();
  });

  it("zero net throws", () => {
    expect(() =>
      mapPayrollPaid({
        payrollPeriodId: "p-3",
        periodLabel: "Test",
        outletId: "outlet-1",
        entryDate: "2026-04-30",
        totalBaseSalary: 0,
        totalOvertimePay: 0,
        totalBonus: 0,
        totalDeductions: 0,
        totalNetPay: 0,
        paymentMethod: "transfer",
      }),
    ).toThrow();
  });
});

// ============================================================
// mapCashDepositVerified
// ============================================================

describe("mapCashDepositVerified", () => {
  it("Dr Bank, Cr 1101 Kas Tunai balanced", () => {
    const lines = mapCashDepositVerified({
      cashDepositId: "d-1",
      outletId: "outlet-1",
      entryDate: "2026-06-05",
      amount: 2_000_000,
      bankAccountCode: "1110",
      bankDestinationLabel: "BCA — Owner",
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "1110")?.debit).toBe(2000000);
    expect(lines.find((l) => l.accountCode === "1101")?.credit).toBe(2000000);
  });
});

describe("resolveBankCodeFromDestination heuristic", () => {
  it("BCA matches", () => {
    expect(resolveBankCodeFromDestination("BCA Owner")).toBe("1110");
    expect(resolveBankCodeFromDestination("transfer ke bca pribadi")).toBe(
      "1110",
    );
  });
  it("BRI matches", () => {
    expect(resolveBankCodeFromDestination("BRI cabang")).toBe("1111");
  });
  it("else falls back ke 1112", () => {
    expect(resolveBankCodeFromDestination("Mandiri")).toBe("1112");
    expect(resolveBankCodeFromDestination("")).toBe("1112");
  });
});

// ============================================================
// mapAggregatorSettlement
// ============================================================

describe("mapAggregatorSettlement", () => {
  const base = {
    settlementId: "s-1",
    outletId: "outlet-1",
    entryDate: "2026-06-30",
    bankAccountCode: "1110",
    periodLabel: "Jun 2026",
  };

  it("GoFood: Dr Bank + Dr 6401 fee + Cr 4104 revenue (no piutang)", () => {
    const lines = mapAggregatorSettlement({
      ...base,
      channel: "gofood",
      grossAmount: 1_000_000,
      feeAmount: 200_000,
      netAmount: 800_000,
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "1110")?.debit).toBe(800000);
    expect(lines.find((l) => l.accountCode === "6401")?.debit).toBe(200000);
    expect(lines.find((l) => l.accountCode === "4104")?.credit).toBe(1000000);
    // No piutang clearance
    expect(lines.find((l) => l.accountCode === "1122")).toBeUndefined();
  });

  it("QRIS: Dr Bank + Dr 6402 MDR + Cr 1120 piutang clear", () => {
    const lines = mapAggregatorSettlement({
      ...base,
      channel: "qris",
      grossAmount: 500_000,
      feeAmount: 5_000,
      netAmount: 495_000,
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "6402")?.debit).toBe(5000);
    expect(lines.find((l) => l.accountCode === "1120")?.credit).toBe(500000);
    // No revenue recognition
    expect(lines.find((l) => l.accountCode === "4104")).toBeUndefined();
  });

  it("EDC BCA: Cr 1121 piutang", () => {
    const lines = mapAggregatorSettlement({
      ...base,
      channel: "edc_bca",
      grossAmount: 300_000,
      feeAmount: 0,
      netAmount: 300_000,
    });
    expect(lines.find((l) => l.accountCode === "1121")?.credit).toBe(300000);
  });

  it("net mismatch throws", () => {
    expect(() =>
      mapAggregatorSettlement({
        ...base,
        channel: "gofood",
        grossAmount: 1000,
        feeAmount: 200,
        netAmount: 700, // should be 800
      }),
    ).toThrow(/NET_MISMATCH/);
  });
});

describe("isPiutangChannel + piutangCodeForChannel", () => {
  it("qris and edc_bca are piutang channels", () => {
    expect(isPiutangChannel("qris")).toBe(true);
    expect(isPiutangChannel("edc_bca")).toBe(true);
    expect(piutangCodeForChannel("qris")).toBe("1120");
    expect(piutangCodeForChannel("edc_bca")).toBe("1121");
  });
  it("aggregator channels are NOT piutang (revenue recognition direct)", () => {
    expect(isPiutangChannel("gofood")).toBe(false);
    expect(isPiutangChannel("grabfood")).toBe(false);
    expect(isPiutangChannel("shopeefood")).toBe(false);
    expect(piutangCodeForChannel("gofood")).toBeNull();
  });
});

// ============================================================
// mapShiftVariance
// ============================================================

describe("mapShiftVariance", () => {
  const base = {
    shiftId: "s-1",
    shiftLabel: "Shift Galih",
    outletId: "outlet-1",
    entryDate: "2026-06-15",
  };

  it("variance=0 → empty array", () => {
    expect(mapShiftVariance({ ...base, variance: 0 })).toEqual([]);
  });

  it("variance < 0 (kas kurang): Dr 6902 Cr 1101", () => {
    const lines = mapShiftVariance({ ...base, variance: -10000 });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "6902")?.debit).toBe(10000);
    expect(lines.find((l) => l.accountCode === "1101")?.credit).toBe(10000);
  });

  it("variance > 0 (kas lebih): Dr 1101 Cr 6902", () => {
    const lines = mapShiftVariance({ ...base, variance: 5000 });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "1101")?.debit).toBe(5000);
    expect(lines.find((l) => l.accountCode === "6902")?.credit).toBe(5000);
  });
});
