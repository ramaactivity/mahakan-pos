import { describe, expect, it } from "vitest";
import { mapPayrollPaid } from "@/features/accounting/mapping";
import { resolveBankCodeFromDestination } from "@/features/accounting/mapping/cashDeposit";
import { payrollPaymentSchema } from "@/features/payroll/schemas";

/**
 * Sesi AE-210 — REKENING SUMBER PEMBAYARAN GAJI.
 *
 * Kejadian nyata yang dikunci di sini: gaji ditransfer dari BRI, tapi
 * sistem mencatatnya keluar dari BCA — dulu SEMUA pembayaran non-tunai
 * hardcoded mengkredit 1110 Bank BCA. Saldo BCA jadi minus dan saldo BRI
 * ketinggian, tanpa satu error pun yang muncul.
 *
 * Yang dijaga tes ini:
 *   1. Rekening yang dipilih benar-benar menentukan akun yang dikredit.
 *   2. Perilaku LAMA tidak berubah diam-diam (tanpa rekening → 1110).
 *   3. "Transfer tanpa rekening" ditolak SEBELUM menyentuh tabel — kalau
 *      lolos, diam-diam jatuh ke 1110 lagi, yaitu bug yang sama.
 */

const BASE = {
  payrollPeriodId: "p-1",
  periodLabel: "Juli 2026",
  outletId: "outlet-1",
  entryDate: "2026-07-31",
  totalBaseSalary: 12_000_000,
  totalOvertimePay: 0,
  totalBonus: 0,
  totalDeductions: 0,
  totalNetPay: 12_000_000,
} as const;

function sum(lines: Array<{ debit?: number; credit?: number }>, side: "debit" | "credit") {
  return lines.reduce((s, l) => s + (l[side] ?? 0), 0);
}

describe("mapPayrollPaid — rekening sumber pembayaran (AE-210)", () => {
  it("transfer dari BRI mengkredit 1111, BUKAN 1110 BCA", () => {
    const lines = mapPayrollPaid({
      ...BASE,
      paymentMethod: "transfer",
      bankAccountCode: resolveBankCodeFromDestination("BRI"),
      bankAccountLabel: "BRI — Mahakan ...4821",
    });
    expect(lines.find((l) => l.accountCode === "1111")?.credit).toBe(12_000_000);
    // Inti bug-nya: BCA tidak boleh tersentuh sama sekali.
    expect(lines.some((l) => l.accountCode === "1110")).toBe(false);
    expect(sum(lines, "debit")).toBe(sum(lines, "credit"));
  });

  it("transfer dari BCA tetap mengkredit 1110", () => {
    const lines = mapPayrollPaid({
      ...BASE,
      paymentMethod: "transfer",
      bankAccountCode: resolveBankCodeFromDestination("BCA"),
    });
    expect(lines.find((l) => l.accountCode === "1110")?.credit).toBe(12_000_000);
  });

  it("bank selain BCA/BRI jatuh ke 1112 Bank Lainnya", () => {
    const lines = mapPayrollPaid({
      ...BASE,
      paymentMethod: "transfer",
      bankAccountCode: resolveBankCodeFromDestination("Mandiri"),
    });
    expect(lines.find((l) => l.accountCode === "1112")?.credit).toBe(12_000_000);
  });

  it("tanpa bankAccountCode → perilaku LAMA (1110), tidak berubah diam-diam", () => {
    const lines = mapPayrollPaid({ ...BASE, paymentMethod: "transfer" });
    expect(lines.find((l) => l.accountCode === "1110")?.credit).toBe(12_000_000);
  });

  it("tunai tetap Cr 1101 walau ada bankAccountCode nyasar", () => {
    const lines = mapPayrollPaid({
      ...BASE,
      paymentMethod: "cash",
      bankAccountCode: "1111",
    });
    expect(lines.find((l) => l.accountCode === "1101")?.credit).toBe(12_000_000);
    expect(lines.some((l) => l.accountCode === "1111")).toBe(false);
  });

  it("deskripsi baris kas menyebut rekeningnya — salah rekening ketahuan dari Buku Besar", () => {
    const lines = mapPayrollPaid({
      ...BASE,
      paymentMethod: "transfer",
      bankAccountCode: "1111",
      bankAccountLabel: "BRI — Mahakan ...4821",
    });
    const kas = lines.find((l) => l.accountCode === "1111");
    expect(kas?.description).toContain("BRI — Mahakan ...4821");
  });

  it("potongan kasbon (1155) tetap utuh saat rekening diganti — AE-209b tidak regresi", () => {
    const lines = mapPayrollPaid({
      ...BASE,
      totalDeductions: 2_000_000,
      totalAdvanceDeduction: 2_000_000,
      totalNetPay: 10_000_000,
      paymentMethod: "transfer",
      bankAccountCode: "1111",
    });
    expect(lines.find((l) => l.accountCode === "1155")?.credit).toBe(2_000_000);
    expect(lines.find((l) => l.accountCode === "1111")?.credit).toBe(10_000_000);
    expect(sum(lines, "debit")).toBe(sum(lines, "credit"));
  });
});

describe("payrollPaymentSchema — bentuk metode + rekening (AE-210)", () => {
  it("TOLAK transfer tanpa rekening — kalau lolos, diam-diam jatuh ke BCA lagi", () => {
    const res = payrollPaymentSchema.safeParse({
      paymentMethod: "transfer",
      bankAccountId: null,
    });
    expect(res.success).toBe(false);
  });

  it("TOLAK tunai yang malah membawa rekening", () => {
    const res = payrollPaymentSchema.safeParse({
      paymentMethod: "cash",
      bankAccountId: "6f3a1c2e-1111-4222-8333-444455556666",
    });
    expect(res.success).toBe(false);
  });

  it("terima transfer dengan rekening, dan tunai tanpa rekening", () => {
    expect(
      payrollPaymentSchema.safeParse({
        paymentMethod: "transfer",
        bankAccountId: "6f3a1c2e-1111-4222-8333-444455556666",
      }).success,
    ).toBe(true);
    expect(
      payrollPaymentSchema.safeParse({
        paymentMethod: "cash",
        bankAccountId: null,
      }).success,
    ).toBe(true);
  });
});

/**
 * Rekonstruksi nilai jurnal saat KOREKSI rekening.
 *
 * updatePayrollPaymentMethod membaca ulang komposisi dari BARIS jurnal
 * lamanya, bukan menghitung ulang dari payroll_lines — baris payroll bisa
 * sudah berubah setelah pembayaran, dan menghitung ulang membuat pembalik
 * dan posting ulang tidak seimbang (jebakan yang sudah kena di AE-199).
 *
 * Yang dites di sini: hasil rekonstruksi memang menghasilkan jurnal baru
 * yang nilainya PERSIS sama dengan yang dibalik, hanya beda akun kas.
 */
describe("koreksi rekening — nilai posting ulang identik dengan yang dibalik", () => {
  it("BCA → BRI: semua baris sama, hanya akun kas yang pindah", () => {
    const original = mapPayrollPaid({
      ...BASE,
      totalOvertimePay: 800_000,
      totalBonus: 500_000,
      totalDeductions: 1_300_000,
      totalAdvanceDeduction: 900_000,
      totalNetPay: 12_000_000,
      paymentMethod: "transfer",
      bankAccountCode: "1110",
    });

    // Rekonstruksi seperti yang dilakukan updatePayrollPaymentMethod.
    const sumOf = (code: string, side: "debit" | "credit") =>
      original
        .filter((l) => l.accountCode === code)
        .reduce((a, l) => a + (l[side] ?? 0), 0);
    const totalDebit = sum(original, "debit");
    const otherDeduction = sumOf("6105", "credit");
    const advanceDeduction = sumOf("1155", "credit");
    const netPay = totalDebit - otherDeduction - advanceDeduction;

    const reposted = mapPayrollPaid({
      ...BASE,
      totalBaseSalary: sumOf("6101", "debit"),
      totalOvertimePay: sumOf("6103", "debit"),
      totalBonus: sumOf("6102", "debit"),
      totalDeductions: otherDeduction + advanceDeduction,
      totalAdvanceDeduction: advanceDeduction,
      totalNetPay: netPay,
      paymentMethod: "transfer",
      bankAccountCode: "1111",
    });

    expect(sum(reposted, "debit")).toBe(sum(original, "debit"));
    expect(sum(reposted, "credit")).toBe(sum(original, "credit"));
    expect(reposted.find((l) => l.accountCode === "1111")?.credit).toBe(
      original.find((l) => l.accountCode === "1110")?.credit,
    );
    // Setelah dibalik + diposting ulang, BCA bersih dari transaksi ini.
    expect(reposted.some((l) => l.accountCode === "1110")).toBe(false);
  });
});
