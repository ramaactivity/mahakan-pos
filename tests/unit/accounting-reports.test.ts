import { describe, it, expect } from "vitest";
import {
  computeOpeningBalanceTotals,
  mapOpeningBalance,
  mapPeriodClose,
} from "@/features/accounting/mapping";
import {
  buildBalanceSheet,
  buildGeneralLedger,
  buildIncomeStatement,
  buildTrialBalance,
  type AccountBalanceRow,
} from "@/features/accounting/reports";

function sumDr(lines: Array<{ debit?: number; credit?: number }>) {
  return lines.reduce((s, l) => s + (l.debit ?? 0), 0);
}
function sumCr(lines: Array<{ debit?: number; credit?: number }>) {
  return lines.reduce((s, l) => s + (l.credit ?? 0), 0);
}

const baseInput = {
  outletId: "o-1",
  entryDate: "2026-05-31",
  kasDrawer: 0,
  kasBrankas: 0,
  bankBca: 0,
  bankBri: 0,
  bankLain: 0,
  piutangQris: 0,
  piutangEdcBca: 0,
  piutangGofood: 0,
  piutangGrabfood: 0,
  piutangShopeefood: 0,
  biayaDibayarDimuka: 0,
  persediaanKitchen: 0,
  persediaanBar: 0,
  persediaanPendukung: 0,
  hutangDagang: 0,
  modalOwner: 0,
  saldoLaba: 0,
};

// ============================================================
// mapOpeningBalance
// ============================================================

describe("mapOpeningBalance", () => {
  it("simple balanced: kas + modal", () => {
    const lines = mapOpeningBalance({
      ...baseInput,
      kasDrawer: 5_000_000,
      modalOwner: 5_000_000,
    });
    expect(sumDr(lines)).toBe(5_000_000);
    expect(sumCr(lines)).toBe(5_000_000);
    expect(lines.find((l) => l.accountCode === "1101")?.debit).toBe(5000000);
    expect(lines.find((l) => l.accountCode === "3101")?.credit).toBe(5000000);
  });

  it("complex: kas + bank + persediaan vs modal + saldo laba", () => {
    const lines = mapOpeningBalance({
      ...baseInput,
      kasDrawer: 1_000_000,
      bankBca: 10_000_000,
      bankBri: 5_000_000,
      persediaanKitchen: 3_000_000,
      persediaanBar: 2_000_000,
      modalOwner: 18_000_000,
      saldoLaba: 3_000_000,
    });
    expect(sumDr(lines)).toBe(21_000_000);
    expect(sumCr(lines)).toBe(21_000_000);
  });

  it("with hutang dagang: balance still correct", () => {
    const lines = mapOpeningBalance({
      ...baseInput,
      bankBca: 5_000_000,
      persediaanKitchen: 2_000_000,
      hutangDagang: 1_000_000,
      modalOwner: 6_000_000,
    });
    expect(sumDr(lines)).toBe(sumCr(lines));
  });

  it("imbalanced throws", () => {
    expect(() =>
      mapOpeningBalance({
        ...baseInput,
        kasDrawer: 1_000,
        modalOwner: 999,
      }),
    ).toThrow(/IMBALANCED/);
  });

  it("zero everywhere throws TOO_FEW_LINES", () => {
    expect(() => mapOpeningBalance(baseInput)).toThrow(/TOO_FEW_LINES/);
  });

  it("skips zero amounts (no Dr 0 lines)", () => {
    const lines = mapOpeningBalance({
      ...baseInput,
      kasDrawer: 100_000,
      modalOwner: 100_000,
    });
    // Only 2 lines: kas + modal. No persediaan/bank/dll.
    expect(lines.length).toBe(2);
  });
});

describe("computeOpeningBalanceTotals", () => {
  it("computes diff correctly", () => {
    const totals = computeOpeningBalanceTotals({
      ...baseInput,
      kasDrawer: 1000,
      modalOwner: 800,
    });
    expect(totals.totalDebit).toBe(1000);
    expect(totals.totalCredit).toBe(800);
    expect(totals.diff).toBe(200);
  });
});

// ============================================================
// mapPeriodClose
// ============================================================

describe("mapPeriodClose", () => {
  const base = {
    outletId: "o-1",
    entryDate: "2026-06-30",
    periodLabel: "2026-06",
  };

  it("pure profit period: revenue closed, transferred ke 3301", () => {
    const lines = mapPeriodClose({
      ...base,
      balances: [
        {
          code: "4101",
          type: "revenue",
          balance: 10_000_000,
          accountId: "rev-1",
        },
        {
          code: "5101",
          type: "cogs",
          balance: 3_000_000,
          accountId: "cogs-1",
        },
        {
          code: "6101",
          type: "expense",
          balance: 2_000_000,
          accountId: "exp-1",
        },
      ],
    });
    expect(sumDr(lines)).toBe(sumCr(lines));
    // Net profit = 10M - 3M - 2M = 5M ke 3301
    expect(
      lines.find((l) => l.accountCode === "3301" && l.credit)?.credit,
    ).toBe(5_000_000);
  });

  it("pure loss period: expense > revenue, transferred from 3301", () => {
    const lines = mapPeriodClose({
      ...base,
      balances: [
        { code: "4101", type: "revenue", balance: 1_000_000, accountId: "r1" },
        { code: "6101", type: "expense", balance: 3_000_000, accountId: "e1" },
      ],
    });
    expect(sumDr(lines)).toBe(sumCr(lines));
    // Net loss = 2M, Dr 3301
    expect(
      lines.find((l) => l.accountCode === "3301" && l.debit)?.debit,
    ).toBe(2_000_000);
  });

  it("zero net (revenue = expense): no 3301 transfer", () => {
    const lines = mapPeriodClose({
      ...base,
      balances: [
        { code: "4101", type: "revenue", balance: 5_000_000, accountId: "r1" },
        { code: "6101", type: "expense", balance: 5_000_000, accountId: "e1" },
      ],
    });
    expect(sumDr(lines)).toBe(sumCr(lines));
    expect(lines.find((l) => l.accountCode === "3301")).toBeUndefined();
  });

  it("contra-revenue (4110 Diskon) handled correctly", () => {
    const lines = mapPeriodClose({
      ...base,
      balances: [
        { code: "4101", type: "revenue", balance: 10_000_000, accountId: "r1" },
        { code: "4110", type: "revenue", balance: 1_000_000, accountId: "r2" }, // contra Dr balance
      ],
    });
    expect(sumDr(lines)).toBe(sumCr(lines));
    // Net to 3301 = 10M - 1M = 9M profit
    expect(
      lines.find((l) => l.accountCode === "3301" && l.credit)?.credit,
    ).toBe(9_000_000);
  });

  it("skips asset/liability/equity accounts (carry forward)", () => {
    const lines = mapPeriodClose({
      ...base,
      balances: [
        { code: "1101", type: "asset", balance: 5_000_000, accountId: "a1" },
        { code: "2101", type: "liability", balance: 1_000_000, accountId: "l1" },
        { code: "4101", type: "revenue", balance: 2_000_000, accountId: "r1" },
      ],
    });
    expect(lines.find((l) => l.accountCode === "1101")).toBeUndefined();
    expect(lines.find((l) => l.accountCode === "2101")).toBeUndefined();
    expect(lines.find((l) => l.accountCode === "4101")).toBeDefined();
  });
});

// ============================================================
// buildTrialBalance
// ============================================================

describe("buildTrialBalance", () => {
  it("balances debit-normal asset (kas drawer Rp 5jt)", () => {
    const balances: AccountBalanceRow[] = [
      {
        accountId: "a1",
        code: "1101",
        name: "Kas Tunai",
        type: "asset",
        normalBalance: "debit",
        isContra: false,
        parentCode: null,
        debitTotal: 5_000_000,
        creditTotal: 0,
      },
      {
        accountId: "a2",
        code: "3101",
        name: "Modal",
        type: "equity",
        normalBalance: "credit",
        isContra: false,
        parentCode: null,
        debitTotal: 0,
        creditTotal: 5_000_000,
      },
    ];
    const tb = buildTrialBalance(balances);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(5_000_000);
    expect(tb.totalCredit).toBe(5_000_000);
    expect(tb.rows[0].code).toBe("1101");
    expect(tb.rows[0].debit).toBe(5_000_000);
    expect(tb.rows[1].credit).toBe(5_000_000);
  });

  it("skips zero-balance rows", () => {
    const balances: AccountBalanceRow[] = [
      {
        accountId: "a1",
        code: "9999",
        name: "Empty",
        type: "asset",
        normalBalance: "debit",
        isContra: false,
        parentCode: null,
        debitTotal: 0,
        creditTotal: 0,
      },
    ];
    expect(buildTrialBalance(balances).rows.length).toBe(0);
  });
});

// ============================================================
// buildIncomeStatement
// ============================================================

describe("buildIncomeStatement", () => {
  it("computes net income correctly", () => {
    const balances: AccountBalanceRow[] = [
      {
        accountId: "r1",
        code: "4101",
        name: "Penjualan Makanan",
        type: "revenue",
        normalBalance: "credit",
        isContra: false,
        parentCode: null,
        debitTotal: 0,
        creditTotal: 5_000_000,
      },
      {
        accountId: "r2",
        code: "4110",
        name: "Diskon",
        type: "revenue",
        normalBalance: "debit",
        isContra: true,
        parentCode: null,
        debitTotal: 200_000,
        creditTotal: 0,
      },
      {
        accountId: "c1",
        code: "5101",
        name: "HPP",
        type: "cogs",
        normalBalance: "debit",
        isContra: false,
        parentCode: null,
        debitTotal: 1_500_000,
        creditTotal: 0,
      },
      {
        accountId: "e1",
        code: "6101",
        name: "Gaji",
        type: "expense",
        normalBalance: "debit",
        isContra: false,
        parentCode: null,
        debitTotal: 1_000_000,
        creditTotal: 0,
      },
    ];
    const is = buildIncomeStatement(balances, "Juni 2026");
    expect(is.revenue.subtotal).toBe(5_000_000);
    expect(is.revenueContra.subtotal).toBe(200_000);
    expect(is.netRevenue).toBe(4_800_000);
    expect(is.cogs.subtotal).toBe(1_500_000);
    expect(is.grossProfit).toBe(3_300_000);
    expect(is.expenses.subtotal).toBe(1_000_000);
    expect(is.netIncome).toBe(2_300_000);
  });
});

// ============================================================
// buildBalanceSheet
// ============================================================

describe("buildBalanceSheet", () => {
  it("balances: assets = liab + equity", () => {
    const balances: AccountBalanceRow[] = [
      {
        accountId: "a1",
        code: "1101",
        name: "Kas",
        type: "asset",
        normalBalance: "debit",
        isContra: false,
        parentCode: null,
        debitTotal: 10_000_000,
        creditTotal: 0,
      },
      {
        accountId: "l1",
        code: "2101",
        name: "Hutang",
        type: "liability",
        normalBalance: "credit",
        isContra: false,
        parentCode: null,
        debitTotal: 0,
        creditTotal: 3_000_000,
      },
      {
        accountId: "e1",
        code: "3101",
        name: "Modal",
        type: "equity",
        normalBalance: "credit",
        isContra: false,
        parentCode: null,
        debitTotal: 0,
        creditTotal: 7_000_000,
      },
    ];
    const bs = buildBalanceSheet(balances, "2026-06-30");
    expect(bs.totalAssets).toBe(10_000_000);
    expect(bs.totalLiabilities).toBe(3_000_000);
    expect(bs.totalEquity).toBe(7_000_000);
    expect(bs.balanced).toBe(true);
  });

  it("with current period net income added to 3302", () => {
    const balances: AccountBalanceRow[] = [
      {
        accountId: "a1",
        code: "1101",
        name: "Kas",
        type: "asset",
        normalBalance: "debit",
        isContra: false,
        parentCode: null,
        debitTotal: 5_000_000,
        creditTotal: 0,
      },
      {
        accountId: "e1",
        code: "3101",
        name: "Modal",
        type: "equity",
        normalBalance: "credit",
        isContra: false,
        parentCode: null,
        debitTotal: 0,
        creditTotal: 3_000_000,
      },
    ];
    const bs = buildBalanceSheet(balances, "2026-06-30", 2_000_000);
    // 3302 added with net income 2M. Total equity = 3M + 2M = 5M = total assets.
    expect(bs.totalEquity).toBe(5_000_000);
    expect(bs.balanced).toBe(true);
  });
});

// ============================================================
// buildGeneralLedger
// ============================================================

describe("buildGeneralLedger", () => {
  it("computes running balance for debit-normal account", () => {
    const report = buildGeneralLedger({
      accountCode: "1101",
      accountName: "Kas",
      accountType: "asset",
      normalBalance: "debit",
      openingBalance: 1_000_000,
      entries: [
        {
          entryNumber: "JE-1",
          entryDate: "2026-06-01",
          entryDescription: "Sale",
          lineDescription: null,
          debit: 50_000,
          credit: 0,
        },
        {
          entryNumber: "JE-2",
          entryDate: "2026-06-02",
          entryDescription: "Setoran",
          lineDescription: null,
          debit: 0,
          credit: 200_000,
        },
      ],
    });
    expect(report.entries[0].balanceAfter).toBe(1_050_000);
    expect(report.entries[1].balanceAfter).toBe(850_000);
    expect(report.closingBalance).toBe(850_000);
  });

  it("running balance for credit-normal account flips sign", () => {
    const report = buildGeneralLedger({
      accountCode: "4101",
      accountName: "Revenue",
      accountType: "revenue",
      normalBalance: "credit",
      openingBalance: 0,
      entries: [
        {
          entryNumber: "JE-1",
          entryDate: "2026-06-01",
          entryDescription: "Sale",
          lineDescription: null,
          debit: 0,
          credit: 100_000,
        },
        {
          entryNumber: "JE-2",
          entryDate: "2026-06-02",
          entryDescription: "Refund",
          lineDescription: null,
          debit: 20_000,
          credit: 0,
        },
      ],
    });
    expect(report.entries[0].balanceAfter).toBe(100_000);
    expect(report.entries[1].balanceAfter).toBe(80_000);
  });
});
