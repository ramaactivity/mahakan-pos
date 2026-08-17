import { describe, expect, it } from "vitest";
import {
  ACCOUNT_PIUTANG_KASBON,
  mapEmployeeAdvanceForgive,
  mapEmployeeAdvanceIssue,
  mapEmployeeAdvanceRepayment,
  mapEmployeeAdvanceRepaymentReversal,
  mapPayrollPaid,
} from "@/features/accounting/mapping";

/**
 * Sesi AE-209b — Kasbon Karyawan sebagai piutang (akun 1155).
 *
 * Yang dikunci di sini: SIKLUS PIUTANG HARUS TUTUP. Debit 1155 saat kasbon
 * diberikan wajib habis oleh credit 1155 dari jalan penyelesaian apa pun
 * (cicilan, potong gaji, forgive). Kalau salah satu jalur salah akun, saldo
 * Piutang Kasbon di Neraca nyangkut atau malah minus tanpa error apa pun.
 */

function sumDebit(lines: Array<{ debit?: number; credit?: number }>) {
  return lines.reduce((s, l) => s + (l.debit ?? 0), 0);
}
function sumCredit(lines: Array<{ debit?: number; credit?: number }>) {
  return lines.reduce((s, l) => s + (l.credit ?? 0), 0);
}
function balanced(lines: Array<{ debit?: number; credit?: number }>) {
  return sumDebit(lines) === sumCredit(lines);
}
/** Saldo 1155: debit positif, credit negatif. */
function piutangDelta(
  lines: Array<{ accountCode?: string; debit?: number; credit?: number }>,
) {
  return lines
    .filter((l) => l.accountCode === ACCOUNT_PIUTANG_KASBON)
    .reduce((s, l) => s + (l.debit ?? 0) - (l.credit ?? 0), 0);
}

describe("mapEmployeeAdvanceIssue", () => {
  it("kasbon tunai → Dr 1155 / Cr 1101", () => {
    const lines = mapEmployeeAdvanceIssue({
      amount: 1_000_000,
      sourceAccountCode: "1101",
      sourceLabel: "Kas",
      employeeName: "Parhan",
    });
    expect(balanced(lines)).toBe(true);
    expect(piutangDelta(lines)).toBe(1_000_000);
    expect(lines.find((l) => l.accountCode === "1101")?.credit).toBe(1_000_000);
  });

  it("kasbon dari bank → Cr akun bank, bukan kas", () => {
    const lines = mapEmployeeAdvanceIssue({
      amount: 500_000,
      sourceAccountCode: "1110",
      sourceLabel: "BCA",
      employeeName: "Anisa",
    });
    expect(lines.find((l) => l.accountCode === "1110")?.credit).toBe(500_000);
    expect(lines.find((l) => l.accountCode === "1101")).toBeUndefined();
  });

  it("tolak nominal <= 0", () => {
    expect(() =>
      mapEmployeeAdvanceIssue({
        amount: 0,
        sourceAccountCode: "1101",
        sourceLabel: "Kas",
        employeeName: "X",
      }),
    ).toThrow(/NONPOSITIVE/);
  });
});

describe("mapEmployeeAdvanceRepayment", () => {
  it("setoran tunai → Dr 1101 / Cr 1155", () => {
    const lines = mapEmployeeAdvanceRepayment({
      amount: 400_000,
      destinationAccountCode: "1101",
      destinationLabel: "Kas",
      employeeName: "Parhan",
    });
    expect(balanced(lines)).toBe(true);
    expect(piutangDelta(lines)).toBe(-400_000);
  });

  it("pembalik cicilan mengembalikan piutang", () => {
    const args = {
      amount: 400_000,
      destinationAccountCode: "1110",
      destinationLabel: "BCA",
      employeeName: "Parhan",
    };
    const reversal = mapEmployeeAdvanceRepaymentReversal({
      ...args,
      reason: "uangnya ternyata tidak masuk",
    });
    expect(balanced(reversal)).toBe(true);
    /* Cicilan + pembaliknya harus saling menghapus persis. */
    expect(
      piutangDelta(mapEmployeeAdvanceRepayment(args)) + piutangDelta(reversal),
    ).toBe(0);
  });
});

describe("mapEmployeeAdvanceForgive", () => {
  it("sisa kasbon dimaafkan → Dr 6102 / Cr 1155", () => {
    const lines = mapEmployeeAdvanceForgive({
      amount: 600_000,
      employeeName: "Parhan",
    });
    expect(balanced(lines)).toBe(true);
    expect(piutangDelta(lines)).toBe(-600_000);
    expect(lines.find((l) => l.accountCode === "6102")?.debit).toBe(600_000);
  });
});

describe("mapPayrollPaid — potongan kasbon lewat 1155", () => {
  const base = {
    payrollPeriodId: "p-1",
    periodLabel: "Agustus 2026",
    outletId: "outlet-1",
    entryDate: "2026-08-31",
    totalBaseSalary: 3_000_000,
    totalOvertimePay: 0,
    totalBonus: 0,
    paymentMethod: "cash" as const,
  };

  it("potongan kasbon ber-jurnal → Cr 1155, bukan 6105", () => {
    const lines = mapPayrollPaid({
      ...base,
      totalDeductions: 600_000,
      totalAdvanceDeduction: 600_000,
      totalNetPay: 2_400_000,
    });
    expect(balanced(lines)).toBe(true);
    expect(piutangDelta(lines)).toBe(-600_000);
    expect(lines.find((l) => l.accountCode === "6105")).toBeUndefined();
  });

  it("potongan campuran dipecah: kasbon ke 1155, sisanya ke 6105", () => {
    const lines = mapPayrollPaid({
      ...base,
      totalDeductions: 700_000, // 600rb kasbon + 100rb telat
      totalAdvanceDeduction: 600_000,
      totalNetPay: 2_300_000,
    });
    expect(balanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "1155")?.credit).toBe(600_000);
    expect(lines.find((l) => l.accountCode === "6105")?.credit).toBe(100_000);
  });

  it("tanpa field kasbon → perilaku lama, semua potongan ke 6105", () => {
    const lines = mapPayrollPaid({
      ...base,
      totalDeductions: 250_000,
      totalNetPay: 2_750_000,
    });
    expect(balanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "6105")?.credit).toBe(250_000);
    expect(lines.find((l) => l.accountCode === "1155")).toBeUndefined();
  });

  it("porsi kasbon nyasar melebihi total potongan tetap balance (di-clamp)", () => {
    /* Pertahanan terhadap angka nyasar dari pemanggil: jangan sampai jurnal
     * jadi tidak balance atau muncul baris 6105 negatif. */
    const lines = mapPayrollPaid({
      ...base,
      totalDeductions: 100_000,
      totalAdvanceDeduction: 900_000,
      totalNetPay: 2_900_000,
    });
    expect(balanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountCode === "1155")?.credit).toBe(100_000);
    expect(lines.find((l) => l.accountCode === "6105")).toBeUndefined();
    expect(lines.every((l) => (l.debit ?? 0) >= 0 && (l.credit ?? 0) >= 0)).toBe(
      true,
    );
  });
});

describe("siklus penuh piutang kasbon tutup di 1155", () => {
  it("kasbon 1jt → cicil 400rb → potong gaji 600rb ⇒ saldo 1155 = 0", () => {
    const issue = mapEmployeeAdvanceIssue({
      amount: 1_000_000,
      sourceAccountCode: "1101",
      sourceLabel: "Kas",
      employeeName: "Parhan",
    });
    const cicil = mapEmployeeAdvanceRepayment({
      amount: 400_000,
      destinationAccountCode: "1101",
      destinationLabel: "Kas",
      employeeName: "Parhan",
    });
    const payroll = mapPayrollPaid({
      payrollPeriodId: "p-1",
      periodLabel: "Agustus 2026",
      outletId: "outlet-1",
      entryDate: "2026-08-31",
      totalBaseSalary: 3_000_000,
      totalOvertimePay: 0,
      totalBonus: 0,
      totalDeductions: 600_000,
      totalAdvanceDeduction: 600_000,
      totalNetPay: 2_400_000,
      paymentMethod: "cash",
    });
    expect(
      piutangDelta(issue) + piutangDelta(cicil) + piutangDelta(payroll),
    ).toBe(0);
  });

  it("kasbon 1jt → cicil 400rb → sisanya di-forgive ⇒ saldo 1155 = 0", () => {
    const issue = mapEmployeeAdvanceIssue({
      amount: 1_000_000,
      sourceAccountCode: "1110",
      sourceLabel: "BCA",
      employeeName: "Anisa",
    });
    const cicil = mapEmployeeAdvanceRepayment({
      amount: 400_000,
      destinationAccountCode: "1110",
      destinationLabel: "BCA",
      employeeName: "Anisa",
    });
    const forgive = mapEmployeeAdvanceForgive({
      amount: 600_000,
      employeeName: "Anisa",
    });
    expect(
      piutangDelta(issue) + piutangDelta(cicil) + piutangDelta(forgive),
    ).toBe(0);
  });
});
