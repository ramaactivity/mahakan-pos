import { describe, expect, it } from "vitest";
import {
  ACCOUNT_HUTANG_INTERNAL,
  mapInternalDebtEntryReversal,
  mapInternalDebtExpense,
  mapInternalDebtLoan,
  mapInternalDebtRepayment,
  mapInternalDebtRepaymentReversal,
} from "@/features/accounting/mapping/internalDebt";

/**
 * Sesi AE-180 — mapping test Hutang Internal (Talangan Owner/Pengelola).
 *
 * Talangan biaya:   Dr <beban> / Cr 2170
 * Pinjaman tunai:   Dr <bank>  / Cr 2170
 * Cicilan:          Dr 2170    / Cr <bank>
 * Reversal:         swap Dr/Cr
 */

function totals(lines: Array<{ debit?: number; credit?: number }>) {
  return {
    dr: lines.reduce((s, l) => s + (l.debit ?? 0), 0),
    cr: lines.reduce((s, l) => s + (l.credit ?? 0), 0),
  };
}

describe("mapInternalDebtExpense (talangan biaya)", () => {
  it("balanced Dr beban / Cr 2170", () => {
    const lines = mapInternalDebtExpense({
      amount: 150_000,
      expenseAccountCode: "6205",
      description: "Beli gas LPG mendadak",
      partyName: "Rama",
    });
    expect(lines).toHaveLength(2);
    const dr = lines.find((l) => l.accountCode === "6205");
    const cr = lines.find((l) => l.accountCode === ACCOUNT_HUTANG_INTERNAL);
    expect(dr?.debit).toBe(150_000);
    expect(cr?.credit).toBe(150_000);
    const t = totals(lines);
    expect(t.dr).toBe(t.cr);
  });

  it("Cr line menyebut nama pihak untuk audit", () => {
    const lines = mapInternalDebtExpense({
      amount: 50_000,
      expenseAccountCode: "6901",
      description: "Token listrik",
      partyName: "Cacil",
    });
    const cr = lines.find((l) => l.accountCode === ACCOUNT_HUTANG_INTERNAL);
    expect(cr?.description).toContain("Cacil");
  });

  it("throws untuk amount <= 0", () => {
    expect(() =>
      mapInternalDebtExpense({
        amount: 0,
        expenseAccountCode: "6901",
        description: "x",
        partyName: "X",
      }),
    ).toThrow("MAP_INTERNAL_DEBT_EXPENSE_NONPOSITIVE");
  });

  it("floor pecahan Rupiah", () => {
    const lines = mapInternalDebtExpense({
      amount: 100_000.9,
      expenseAccountCode: "6901",
      description: "x",
      partyName: "X",
    });
    expect(lines[0].debit).toBe(100_000);
    expect(lines[1].credit).toBe(100_000);
  });
});

describe("mapInternalDebtLoan (pinjaman tunai)", () => {
  it("balanced Dr bank / Cr 2170", () => {
    const lines = mapInternalDebtLoan({
      amount: 2_000_000,
      bankAccountCode: "1110",
      bankLabel: "BCA — Mahakan",
      partyName: "Rama",
    });
    expect(lines).toHaveLength(2);
    const dr = lines.find((l) => l.accountCode === "1110");
    const cr = lines.find((l) => l.accountCode === ACCOUNT_HUTANG_INTERNAL);
    expect(dr?.debit).toBe(2_000_000);
    expect(cr?.credit).toBe(2_000_000);
    const t = totals(lines);
    expect(t.dr).toBe(t.cr);
  });

  it("throws untuk amount <= 0", () => {
    expect(() =>
      mapInternalDebtLoan({
        amount: -5,
        bankAccountCode: "1110",
        bankLabel: "BCA",
        partyName: "X",
      }),
    ).toThrow("MAP_INTERNAL_DEBT_LOAN_NONPOSITIVE");
  });
});

describe("mapInternalDebtEntryReversal", () => {
  it("swap Dr/Cr: Dr 2170 / Cr counter account", () => {
    const lines = mapInternalDebtEntryReversal({
      amount: 150_000,
      counterAccountCode: "6205",
      partyName: "Rama",
      reason: "salah input nominal",
    });
    const dr = lines.find((l) => l.accountCode === ACCOUNT_HUTANG_INTERNAL);
    const cr = lines.find((l) => l.accountCode === "6205");
    expect(dr?.debit).toBe(150_000);
    expect(cr?.credit).toBe(150_000);
    expect(dr?.description).toContain("salah input nominal");
    const t = totals(lines);
    expect(t.dr).toBe(t.cr);
  });
});

describe("mapInternalDebtRepayment (cicilan)", () => {
  it("balanced Dr 2170 / Cr bank", () => {
    const lines = mapInternalDebtRepayment({
      amount: 500_000,
      bankAccountCode: "1111",
      bankLabel: "BRI — Mahakan",
      partyName: "Rama",
    });
    expect(lines).toHaveLength(2);
    const dr = lines.find((l) => l.accountCode === ACCOUNT_HUTANG_INTERNAL);
    const cr = lines.find((l) => l.accountCode === "1111");
    expect(dr?.debit).toBe(500_000);
    expect(cr?.credit).toBe(500_000);
    const t = totals(lines);
    expect(t.dr).toBe(t.cr);
  });

  it("throws untuk amount <= 0", () => {
    expect(() =>
      mapInternalDebtRepayment({
        amount: 0,
        bankAccountCode: "1110",
        bankLabel: "BCA",
        partyName: "X",
      }),
    ).toThrow("MAP_INTERNAL_DEBT_REPAYMENT_NONPOSITIVE");
  });
});

describe("mapInternalDebtRepaymentReversal", () => {
  it("swap Dr/Cr: Dr bank / Cr 2170 + reason di description", () => {
    const lines = mapInternalDebtRepaymentReversal({
      amount: 500_000,
      bankAccountCode: "1111",
      bankLabel: "BRI — Mahakan",
      partyName: "Rama",
      reason: "salah pilih bank",
    });
    const dr = lines.find((l) => l.accountCode === "1111");
    const cr = lines.find((l) => l.accountCode === ACCOUNT_HUTANG_INTERNAL);
    expect(dr?.debit).toBe(500_000);
    expect(cr?.credit).toBe(500_000);
    expect(cr?.description).toContain("salah pilih bank");
    const t = totals(lines);
    expect(t.dr).toBe(t.cr);
  });
});
