import { describe, expect, it } from "vitest";
import {
  mapDividendDistribution,
  mapDividendDistributionV2,
  mapDividendDistributionReversal,
} from "@/features/accounting/mapping/dividendDistribution";
import {
  mapDividendWithdrawal,
  mapDividendWithdrawalReversal,
  resolveBankCodeFromBankName,
} from "@/features/accounting/mapping/dividendWithdrawal";
import {
  mapCreditorRepayment,
  mapCreditorRepaymentReversal,
} from "@/features/accounting/mapping/creditorRepayment";
import {
  mapShareBuyback,
  mapShareBuybackReversal,
} from "@/features/accounting/mapping/shareBuyback";

/**
 * Sesi AE-80 — Mapping pure tests.
 *
 * Invariant: total Dr == total Cr untuk setiap mapping. Account codes
 * match COA seed (2150, 2160, 3201, 3202, 3401, 6701, dll).
 */

function sumLines(lines: { debit?: number; credit?: number }[]): {
  debit: number;
  credit: number;
} {
  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    debit += l.debit ?? 0;
    credit += l.credit ?? 0;
  }
  return { debit, credit };
}

describe("Dividend distribution mappings", () => {
  it("V1 (legacy): Dr 3201 / Cr 1101 balanced", () => {
    const lines = mapDividendDistribution({
      bagiHasilAmount: 1_000_000,
      periodLabel: "Mei 2026",
    });
    expect(lines.length).toBe(2);
    expect(lines[0].accountCode).toBe("3201");
    expect(lines[0].debit).toBe(1_000_000);
    expect(lines[1].accountCode).toBe("1101");
    expect(lines[1].credit).toBe(1_000_000);
    const sum = sumLines(lines);
    expect(sum.debit).toBe(sum.credit);
  });

  it("V2: Dr 3201 / Cr 3202 (re-classify ke liability)", () => {
    const lines = mapDividendDistributionV2({
      bagiHasilAmount: 500_000,
      periodLabel: "Mei 2026",
    });
    expect(lines[0].accountCode).toBe("3201");
    expect(lines[0].debit).toBe(500_000);
    expect(lines[1].accountCode).toBe("3202");
    expect(lines[1].credit).toBe(500_000);
    expect(sumLines(lines).debit).toBe(sumLines(lines).credit);
  });

  it("V2 reversal: Dr 3202 / Cr 3201 (swap)", () => {
    const lines = mapDividendDistributionReversal({
      bagiHasilAmount: 500_000,
      periodLabel: "Mei 2026",
    });
    expect(lines[0].accountCode).toBe("3202");
    expect(lines[0].debit).toBe(500_000);
    expect(lines[1].accountCode).toBe("3201");
    expect(lines[1].credit).toBe(500_000);
    expect(sumLines(lines).debit).toBe(sumLines(lines).credit);
  });
});

describe("Dividend withdrawal mappings", () => {
  it("withdrawal: Dr 3202 / Cr Bank balanced", () => {
    const lines = mapDividendWithdrawal({
      amount: 250_000,
      bankAccountCode: "1110",
      bankDestinationLabel: "BCA Anisa ...2515",
      investorName: "Anisa",
    });
    expect(lines[0].accountCode).toBe("3202");
    expect(lines[0].debit).toBe(250_000);
    expect(lines[1].accountCode).toBe("1110");
    expect(lines[1].credit).toBe(250_000);
    expect(sumLines(lines).debit).toBe(sumLines(lines).credit);
  });

  it("reversal: Dr Bank / Cr 3202 (swap)", () => {
    const lines = mapDividendWithdrawalReversal({
      amount: 250_000,
      bankAccountCode: "1110",
      bankDestinationLabel: "BCA Anisa ...2515",
      investorName: "Anisa",
      reason: "salah transfer",
    });
    expect(lines[0].accountCode).toBe("1110");
    expect(lines[0].debit).toBe(250_000);
    expect(lines[1].accountCode).toBe("3202");
    expect(lines[1].credit).toBe(250_000);
    expect(sumLines(lines).debit).toBe(sumLines(lines).credit);
  });

  it("amount <= 0 throws", () => {
    expect(() =>
      mapDividendWithdrawal({
        amount: 0,
        bankAccountCode: "1110",
        bankDestinationLabel: "x",
        investorName: "x",
      }),
    ).toThrow();
  });

  it("resolveBankCodeFromBankName mapping", () => {
    expect(resolveBankCodeFromBankName("BCA")).toBe("1110");
    expect(resolveBankCodeFromBankName("Bank BCA")).toBe("1110");
    expect(resolveBankCodeFromBankName("BRI")).toBe("1111");
    expect(resolveBankCodeFromBankName("Bank Mandiri")).toBe("1112");
    expect(resolveBankCodeFromBankName("Unknown")).toBe("1112");
  });
});

describe("Creditor repayment mappings", () => {
  it("repayment principal-only (no interest)", () => {
    const lines = mapCreditorRepayment({
      principalAmount: 1_000_000,
      interestAmount: 0,
      bankAccountCode: "1110",
      bankDestinationLabel: "BCA",
      creditorName: "Pak Budi",
    });
    expect(lines.length).toBe(2); // Dr principal + Cr bank (no Dr interest)
    expect(lines[0].accountCode).toBe("2150");
    expect(lines[0].debit).toBe(1_000_000);
    expect(lines[1].accountCode).toBe("1110");
    expect(lines[1].credit).toBe(1_000_000);
    expect(sumLines(lines).debit).toBe(sumLines(lines).credit);
  });

  it("repayment with interest: 3 lines (Dr principal + Dr interest + Cr bank)", () => {
    const lines = mapCreditorRepayment({
      principalAmount: 1_000_000,
      interestAmount: 50_000,
      bankAccountCode: "1110",
      bankDestinationLabel: "BCA",
      creditorName: "Pak Budi",
    });
    expect(lines.length).toBe(3);
    expect(lines[0].accountCode).toBe("2150");
    expect(lines[0].debit).toBe(1_000_000);
    expect(lines[1].accountCode).toBe("6701");
    expect(lines[1].debit).toBe(50_000);
    expect(lines[2].accountCode).toBe("1110");
    expect(lines[2].credit).toBe(1_050_000);
    expect(sumLines(lines).debit).toBe(sumLines(lines).credit);
  });

  it("repayment interest-only (no principal)", () => {
    const lines = mapCreditorRepayment({
      principalAmount: 0,
      interestAmount: 50_000,
      bankAccountCode: "1110",
      bankDestinationLabel: "BCA",
      creditorName: "Pak Budi",
    });
    expect(lines.length).toBe(2);
    expect(lines[0].accountCode).toBe("6701");
    expect(lines[1].accountCode).toBe("1110");
    expect(sumLines(lines).debit).toBe(sumLines(lines).credit);
  });

  it("repayment zero total throws", () => {
    expect(() =>
      mapCreditorRepayment({
        principalAmount: 0,
        interestAmount: 0,
        bankAccountCode: "1110",
        bankDestinationLabel: "BCA",
        creditorName: "x",
      }),
    ).toThrow();
  });

  it("reversal: swap Dr/Cr", () => {
    const lines = mapCreditorRepaymentReversal({
      principalAmount: 1_000_000,
      interestAmount: 50_000,
      bankAccountCode: "1110",
      bankDestinationLabel: "BCA",
      creditorName: "Pak Budi",
      reason: "salah input",
    });
    expect(lines[0].accountCode).toBe("1110");
    expect(lines[0].debit).toBe(1_050_000);
    expect(sumLines(lines).debit).toBe(sumLines(lines).credit);
  });
});

describe("Share buyback mappings", () => {
  it("buyback: Dr 3401 / Cr Bank balanced", () => {
    const lines = mapShareBuyback({
      amount: 5_000_000,
      bankAccountCode: "1110",
      bankDestinationLabel: "BCA",
      investorName: "Anisa",
      sharePctDelta: 5.0,
    });
    expect(lines[0].accountCode).toBe("3401");
    expect(lines[0].debit).toBe(5_000_000);
    expect(lines[1].accountCode).toBe("1110");
    expect(lines[1].credit).toBe(5_000_000);
    expect(sumLines(lines).debit).toBe(sumLines(lines).credit);
  });

  it("reversal: swap", () => {
    const lines = mapShareBuybackReversal({
      amount: 5_000_000,
      bankAccountCode: "1110",
      bankDestinationLabel: "BCA",
      investorName: "Anisa",
      sharePctDelta: 5.0,
      reason: "investor request",
    });
    expect(lines[0].accountCode).toBe("1110");
    expect(lines[1].accountCode).toBe("3401");
    expect(sumLines(lines).debit).toBe(sumLines(lines).credit);
  });

  it("amount <= 0 throws", () => {
    expect(() =>
      mapShareBuyback({
        amount: -1,
        bankAccountCode: "1110",
        bankDestinationLabel: "BCA",
        investorName: "x",
        sharePctDelta: 5,
      }),
    ).toThrow();
  });
});
