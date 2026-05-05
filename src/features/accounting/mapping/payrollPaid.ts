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
 *      Cr 1101 Kas / 1110 Bank     netPay (= base + OT + bonus - deductions)
 *
 * Sum debit  = base + OT + bonus
 * Sum credit = deductions + netPay = base + OT + bonus  ✓ balanced.
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
  /** Sum of (lateDeduction + otherDeductions). */
  totalDeductions: number;
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
  if (input.totalDeductions > 0) {
    lines.push({
      accountCode: "6105",
      credit: input.totalDeductions,
      description: `Potongan Karyawan ${input.periodLabel}`,
    });
  }

  lines.push({
    accountCode: cashAccount,
    credit: input.totalNetPay,
    description: `Pembayaran payroll ${input.periodLabel}`,
  });

  return lines;
}
