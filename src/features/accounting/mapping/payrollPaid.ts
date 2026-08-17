/**
 * mapPayrollPaid — payroll period mark-paid → journal lines.
 *
 * Phase 5.2 (sesi AC-2): emit per-component breakdown instead of single
 * lump-sum, supaya P&L dan reports dapat split visibility (gaji pokok vs
 * lembur vs bonus). Akun yang dipakai sudah diseed sejak sesi S:
 *   Dr 6101 Gaji Karyawan          baseSalary
 *   Dr 6103 Lembur                 overtimePay
 *   Dr 6102 Tunjangan & Bonus      bonus
 *      Cr 6105 Potongan Karyawan   lateDeduction + otherDeductions  (kontra-expense, NEW)
 *      Cr 1155 Piutang Kasbon      advanceDeduction (sesi AE-209b)
 *      Cr 1101 Kas / 1110 Bank     netPay (= base + OT + bonus - deductions)
 *
 * Sum debit  = base + OT + bonus
 * Sum credit = deductions + netPay = base + OT + bonus  ✓ balanced.
 *
 * Sesi AE-209b — potongan kasbon dipisah dari 6105 ke 1155 Piutang Kasbon
 * Karyawan. Alasannya: potong gaji itu PELUNASAN piutang (uang perusahaan
 * yang dipegang karyawan balik lewat gaji), bukan pengurang beban gaji.
 * Sebelumnya semuanya nyangkut di 6105 tanpa pasangan debit, jadi beban
 * gaji kekecilan dan kas GL ketinggian.
 *
 * `totalAdvanceDeduction` WAJIB hanya mencakup kasbon yang punya jurnal
 * pembukaan Dr 1155 (lihat komentar di mapping/employeeAdvance.ts).
 * Potongan kasbon lama yang tidak pernah dijurnal tetap harus ikut jalur
 * 6105 — kalau tidak, saldo piutang jadi MINUS tanpa error apa pun.
 *
 * Akun 6105 dirilis additive di migration 0028. Auto-journal flag default
 * OFF — owner toggle setelah cutover, jadi safe untuk deploy code first.
 *
 * Idempotency via sourceId = payrollPeriodId tetap berlaku.
 */

import type { JournalLineInput } from "../posting";

export type PayrollPaidInput = {
  payrollPeriodId: string;
  /** Period label "Januari 2026" — untuk description. */
  periodLabel: string;
  outletId: string;
  /** Date paid (YYYY-MM-DD WIB). */
  entryDate: string;
  /** Sum of payroll_lines.baseSalary for the period. */
  totalBaseSalary: number;
  /** Sum of payroll_lines.overtimePay. */
  totalOvertimePay: number;
  /** Sum of payroll_lines.bonus. */
  totalBonus: number;
  /** Sum SEMUA potongan (lateDeduction + advanceDeduction + otherDeductions). */
  totalDeductions: number;
  /** Sesi AE-209b — bagian potongan yang berasal dari kasbon ber-jurnal
   * (Dr 1155 saat kasbon diberikan). Di-credit ke 1155, bukan 6105.
   * Default 0 = perilaku lama (semua potongan ke 6105). */
  totalAdvanceDeduction?: number;
  /** Sum of netPay = base + OT + bonus - deductions. Must match. */
  totalNetPay: number;
  /** "cash" → Cr 1101; "transfer" / others → Cr 1110 (Bank BCA default). */
  paymentMethod: "cash" | "transfer";
};

export function mapPayrollPaid(input: PayrollPaidInput): JournalLineInput[] {
  if (input.totalNetPay <= 0) {
    throw new Error("MAP_PAYROLL_PAID_NONPOSITIVE");
  }

  const expectedNet =
    input.totalBaseSalary +
    input.totalOvertimePay +
    input.totalBonus -
    input.totalDeductions;
  if (Math.abs(expectedNet - input.totalNetPay) > 1) {
    // Allow ±1 rupiah rounding tolerance.
    throw new Error("MAP_PAYROLL_PAID_BREAKDOWN_MISMATCH");
  }

  const cashAccount = input.paymentMethod === "cash" ? "1101" : "1110";
  const lines: JournalLineInput[] = [];

  if (input.totalBaseSalary > 0) {
    lines.push({
      accountCode: "6101",
      debit: input.totalBaseSalary,
      description: `Gaji Pokok ${input.periodLabel}`,
    });
  }
  if (input.totalOvertimePay > 0) {
    lines.push({
      accountCode: "6103",
      debit: input.totalOvertimePay,
      description: `Lembur ${input.periodLabel}`,
    });
  }
  if (input.totalBonus > 0) {
    lines.push({
      accountCode: "6102",
      debit: input.totalBonus,
      description: `Tunjangan & Bonus ${input.periodLabel}`,
    });
  }
  /* Sesi AE-209b — pisahkan potongan kasbon (pelunasan piutang 1155) dari
   * potongan lain (kontra-beban 6105). Di-clamp ke rentang [0, total]
   * supaya angka nyasar dari pemanggil tidak pernah bikin jurnal tak
   * balance atau baris bernilai negatif. */
  const advancePortion = Math.min(
    Math.max(Math.floor(input.totalAdvanceDeduction ?? 0), 0),
    input.totalDeductions,
  );
  const otherPortion = input.totalDeductions - advancePortion;

  if (otherPortion > 0) {
    lines.push({
      accountCode: "6105",
      credit: otherPortion,
      description: `Potongan Karyawan ${input.periodLabel}`,
    });
  }
  if (advancePortion > 0) {
    lines.push({
      accountCode: "1155",
      credit: advancePortion,
      description: `Pelunasan kasbon lewat potong gaji ${input.periodLabel}`,
    });
  }

  lines.push({
    accountCode: cashAccount,
    credit: input.totalNetPay,
    description: `Pembayaran payroll ${input.periodLabel}`,
  });

  return lines;
}
