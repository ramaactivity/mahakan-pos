import { describe, it, expect } from "vitest";
import {
  expenseCashBankCode,
  incomeCashBankCode,
  mapExpenseCreate,
  mapIncomeCreate,
  mapOpnameAdjustment,
  mapPurchaseCancel,
  mapPurchaseCreate,
  mapPurchasePay,
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
// mapPurchaseCreate
// ============================================================

describe("mapPurchaseCreate", () => {
  const base = {
    purchaseId: "p-1",
    purchaseLabel: "INV-001",
    outletId: "o-1",
    entryDate: "2026-06-01",
  };

  it("cash purchase kitchen-only → Dr 1140 Cr 1101 balanced", () => {
    const lines = mapPurchaseCreate({
      ...base,
      paymentMethod: "cash",
      total: 500_000,
      lines: [{ section: "kitchen", amount: 500_000 }],
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "1140")?.debit).toBe(500000);
    expect(lines.find((l) => l.accountCode === "1101")?.credit).toBe(500000);
  });

  it("transfer_bca purchase mixed sections", () => {
    const lines = mapPurchaseCreate({
      ...base,
      paymentMethod: "transfer_bca",
      total: 1_000_000,
      lines: [
        { section: "kitchen", amount: 600_000 },
        { section: "bar", amount: 300_000 },
        { section: "supporting", amount: 100_000 },
      ],
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "1140")?.debit).toBe(600000);
    expect(lines.find((l) => l.accountCode === "1141")?.debit).toBe(300000);
    expect(lines.find((l) => l.accountCode === "1142")?.debit).toBe(100000);
    expect(lines.find((l) => l.accountCode === "1110")?.credit).toBe(1000000);
  });

  it("TOP purchase → Cr 2101 Hutang Dagang", () => {
    const lines = mapPurchaseCreate({
      ...base,
      paymentMethod: "top",
      total: 2_000_000,
      lines: [{ section: "kitchen", amount: 2_000_000 }],
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "2101")?.credit).toBe(2000000);
    expect(lines.find((l) => l.accountCode === "1101")).toBeUndefined();
  });

  it("section null → 1142 fallback", () => {
    const lines = mapPurchaseCreate({
      ...base,
      paymentMethod: "cash",
      total: 100_000,
      lines: [{ section: null, amount: 100_000 }],
    });
    expect(lines.find((l) => l.accountCode === "1142")?.debit).toBe(100000);
  });

  it("lines mismatch with total throws", () => {
    expect(() =>
      mapPurchaseCreate({
        ...base,
        paymentMethod: "cash",
        total: 100_000,
        lines: [{ section: "kitchen", amount: 90_000 }],
      }),
    ).toThrow(/MAP_PURCHASE_CREATE_LINES_MISMATCH/);
  });
});

// ============================================================
// mapPurchasePay
// ============================================================

describe("mapPurchasePay", () => {
  it("cash → Dr 2101 Cr 1101 balanced", () => {
    const lines = mapPurchasePay({
      purchaseId: "p-1",
      purchaseLabel: "INV-001",
      outletId: "o-1",
      entryDate: "2026-06-15",
      paymentMethod: "cash",
      total: 500_000,
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "2101")?.debit).toBe(500000);
    expect(lines.find((l) => l.accountCode === "1101")?.credit).toBe(500000);
  });

  it("transfer_bri → Cr 1111", () => {
    const lines = mapPurchasePay({
      purchaseId: "p-2",
      purchaseLabel: "INV-002",
      outletId: "o-1",
      entryDate: "2026-06-15",
      paymentMethod: "transfer_bri",
      total: 1_000_000,
    });
    expect(lines.find((l) => l.accountCode === "1111")?.credit).toBe(1000000);
  });
});

// ============================================================
// mapPurchaseCancel
// ============================================================

describe("mapPurchaseCancel", () => {
  it("cash cancel → reverse persediaan + kas", () => {
    const lines = mapPurchaseCancel({
      purchaseId: "p-1",
      purchaseLabel: "INV-001",
      outletId: "o-1",
      entryDate: "2026-06-02",
      paymentMethod: "cash",
      total: 500_000,
      lines: [{ section: "kitchen", amount: 500_000 }],
    });
    expect(isBalanced(lines)).toBe(true);
    // Persediaan kitchen credit (reverse the debit), kas debit (reverse the credit)
    expect(lines.find((l) => l.accountCode === "1140")?.credit).toBe(500000);
    expect(lines.find((l) => l.accountCode === "1101")?.debit).toBe(500000);
  });

  it("TOP cancel → reverse hutang dagang", () => {
    const lines = mapPurchaseCancel({
      purchaseId: "p-2",
      purchaseLabel: "INV-002",
      outletId: "o-1",
      entryDate: "2026-06-02",
      paymentMethod: "top",
      total: 1_000_000,
      lines: [{ section: "bar", amount: 1_000_000 }],
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "2101")?.debit).toBe(1000000);
    expect(lines.find((l) => l.accountCode === "1141")?.credit).toBe(1000000);
  });
});

// ============================================================
// mapExpenseCreate
// ============================================================

describe("mapExpenseCreate", () => {
  it("manual expense cash → Dr expense Cr 1101", () => {
    const lines = mapExpenseCreate({
      expenseId: "e-1",
      outletId: "o-1",
      entryDate: "2026-06-15",
      amount: 2_500_000,
      description: "Sewa Juni",
      paymentMethod: "cash",
      expenseAccountCode: "6201", // Sewa Tempat
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "6201")?.debit).toBe(2500000);
    expect(lines.find((l) => l.accountCode === "1101")?.credit).toBe(2500000);
  });

  it("transfer expense → Cr 1110", () => {
    const lines = mapExpenseCreate({
      expenseId: "e-2",
      outletId: "o-1",
      entryDate: "2026-06-20",
      amount: 500_000,
      description: "Listrik PLN",
      paymentMethod: "transfer",
      expenseAccountCode: "6202",
    });
    expect(lines.find((l) => l.accountCode === "1110")?.credit).toBe(500000);
  });

  it("zero throws", () => {
    expect(() =>
      mapExpenseCreate({
        expenseId: "e-3",
        outletId: "o-1",
        entryDate: "2026-06-20",
        amount: 0,
        description: "Test",
        paymentMethod: "cash",
        expenseAccountCode: "6901",
      }),
    ).toThrow();
  });
});

describe("expenseCashBankCode", () => {
  it("maps payment methods to expected accounts", () => {
    expect(expenseCashBankCode("cash")).toBe("1101");
    expect(expenseCashBankCode("transfer")).toBe("1110");
    expect(expenseCashBankCode("other")).toBe("1112");
  });
});

// ============================================================
// mapIncomeCreate
// ============================================================

describe("mapIncomeCreate", () => {
  it("cash income → Dr 1101 Cr 4201 balanced", () => {
    const lines = mapIncomeCreate({
      incomeId: "i-1",
      outletId: "o-1",
      entryDate: "2026-06-10",
      amount: 1_500_000,
      description: "Sewa ruangan event",
      paymentMethod: "cash",
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "1101")?.debit).toBe(1500000);
    expect(lines.find((l) => l.accountCode === "4201")?.credit).toBe(1500000);
  });

  it("transfer income → Dr 1110", () => {
    const lines = mapIncomeCreate({
      incomeId: "i-2",
      outletId: "o-1",
      entryDate: "2026-06-12",
      amount: 500_000,
      description: "Titip jual produk",
      paymentMethod: "transfer",
    });
    expect(lines.find((l) => l.accountCode === "1110")?.debit).toBe(500000);
  });
});

describe("incomeCashBankCode", () => {
  it("maps correctly", () => {
    expect(incomeCashBankCode("cash")).toBe("1101");
    expect(incomeCashBankCode("transfer")).toBe("1110");
    expect(incomeCashBankCode("other")).toBe("1112");
  });
});

// ============================================================
// mapOpnameAdjustment
// ============================================================

describe("mapOpnameAdjustment", () => {
  const base = {
    opnameSessionId: "op-1",
    outletId: "o-1",
    entryDate: "2026-06-30",
    sessionLabel: "Opname Mei 2026",
  };

  it("pure shortage → Dr 6903 Cr persediaan balanced", () => {
    const lines = mapOpnameAdjustment({
      ...base,
      sectionDiffs: [{ section: "kitchen", diffValue: -50_000 }],
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "6903")?.debit).toBe(50000);
    expect(lines.find((l) => l.accountCode === "1140")?.credit).toBe(50000);
  });

  it("pure surplus → Dr persediaan Cr 6903 (gain)", () => {
    const lines = mapOpnameAdjustment({
      ...base,
      sectionDiffs: [{ section: "bar", diffValue: 30_000 }],
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "1141")?.debit).toBe(30000);
    expect(lines.find((l) => l.accountCode === "6903")?.credit).toBe(30000);
  });

  it("mixed shortage + surplus net loss", () => {
    const lines = mapOpnameAdjustment({
      ...base,
      sectionDiffs: [
        { section: "kitchen", diffValue: -100_000 },
        { section: "bar", diffValue: 30_000 },
      ],
    });
    expect(isBalanced(lines)).toBe(true);
    // Net 6903 debit = 100k - 30k = 70k loss
    const sixNineZeroThree = lines.find((l) => l.accountCode === "6903");
    expect(sixNineZeroThree?.debit).toBe(70000);
    expect(sixNineZeroThree?.credit ?? 0).toBe(0);
  });

  it("mixed shortage + surplus net gain", () => {
    const lines = mapOpnameAdjustment({
      ...base,
      sectionDiffs: [
        { section: "kitchen", diffValue: -10_000 },
        { section: "bar", diffValue: 50_000 },
      ],
    });
    expect(isBalanced(lines)).toBe(true);
    // Net 6903 credit = 50k - 10k = 40k gain
    const sixNineZeroThree = lines.find((l) => l.accountCode === "6903");
    expect(sixNineZeroThree?.credit).toBe(40000);
    expect(sixNineZeroThree?.debit ?? 0).toBe(0);
  });

  it("perfectly cancelling → no 6903 line, just persediaan reshuffling", () => {
    const lines = mapOpnameAdjustment({
      ...base,
      sectionDiffs: [
        { section: "kitchen", diffValue: -50_000 },
        { section: "bar", diffValue: 50_000 },
      ],
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "6903")).toBeUndefined();
    expect(lines.find((l) => l.accountCode === "1140")?.credit).toBe(50000);
    expect(lines.find((l) => l.accountCode === "1141")?.debit).toBe(50000);
  });

  /* Sesi AE-182 — diffValue = qty desimal × harga desimal, jadi pecahan.
   * Kolom debit/credit bertipe bigint; nilai pecahan ditolak Postgres
   * (SQLSTATE 22P02) dan bikin jurnal opname gagal permanen. Tiga jurnal
   * opname hilang karena ini sebelum diperbaiki. */
  it("nilai desimal dibulatkan ke rupiah bulat (bigint-safe)", () => {
    const lines = mapOpnameAdjustment({
      ...base,
      sectionDiffs: [
        { section: "kitchen", diffValue: -428_126.8473 },
        { section: "bar", diffValue: 12_345.6 },
      ],
    });
    expect(isBalanced(lines)).toBe(true);
    for (const l of lines) {
      expect(Number.isInteger(l.debit ?? 0)).toBe(true);
      expect(Number.isInteger(l.credit ?? 0)).toBe(true);
    }
    expect(lines.find((l) => l.accountCode === "1140")?.credit).toBe(428_127);
    expect(lines.find((l) => l.accountCode === "1141")?.debit).toBe(12_346);
    expect(lines.find((l) => l.accountCode === "6903")?.debit).toBe(415_781);
  });

  it("pecahan di bawah setengah rupiah dianggap nol", () => {
    const lines = mapOpnameAdjustment({
      ...base,
      sectionDiffs: [{ section: "kitchen", diffValue: 0.4 }],
    });
    expect(lines).toEqual([]);
  });

  it("all zero diffs → empty array", () => {
    expect(
      mapOpnameAdjustment({
        ...base,
        sectionDiffs: [{ section: "kitchen", diffValue: 0 }],
      }),
    ).toEqual([]);
  });

  it("supporting + cleaning both go to 1142", () => {
    const lines = mapOpnameAdjustment({
      ...base,
      sectionDiffs: [
        { section: "supporting", diffValue: -10_000 },
        { section: "cleaning", diffValue: -5_000 },
      ],
    });
    // Aggregated to 1142: -15000 → Cr 15000
    expect(lines.find((l) => l.accountCode === "1142")?.credit).toBe(15000);
    expect(lines.find((l) => l.accountCode === "6903")?.debit).toBe(15000);
  });
});
