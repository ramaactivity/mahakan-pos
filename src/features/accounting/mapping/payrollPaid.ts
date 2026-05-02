/**
 * mapPayrollPaid — payroll period mark-paid → journal lines.
 *
 * Mapping per design doc §4.11:
 *   Dr 6101 Gaji Karyawan                  sum(payroll_lines.netPay)
 *      Cr 1101 Kas / 1110 Bank             per paymentMethod default
 *
 * Q1 Finance flow already auto-creates kas expense entry (sourceType='payroll').
 * Auto-journal hook ditambahkan di sesi T = additional ledger record yang
 * mirror expense itu. Caller harus pakai sourceId = payrollPeriodId untuk
 * idempotency (skip kalau sudah pernah journal).
 */

import type { JournalLineInput } from "../posting";

export type PayrollPaidInput = {
  payrollPeriodId: string;
  /** Period label "Januari 2026" — untuk description. */
  periodLabel: string;
  outletId: string;
  /** Date paid (YYYY-MM-DD WIB). */
  entryDate: string;
  /** Sum of payroll_lines.netPay. */
  totalNetPay: number;
  /** "cash" → Cr 1101; "transfer" / others → Cr 1110 (Bank BCA default). */
  paymentMethod: "cash" | "transfer";
};

export function mapPayrollPaid(input: PayrollPaidInput): JournalLineInput[] {
  if (input.totalNetPay <= 0) {
    throw new Error("MAP_PAYROLL_PAID_NONPOSITIVE");
  }

  const cashAccount = input.paymentMethod === "cash" ? "1101" : "1110";

  return [
    {
      accountCode: "6101",
      debit: input.totalNetPay,
      description: `Gaji Karyawan ${input.periodLabel}`,
    },
    {
      accountCode: cashAccount,
      credit: input.totalNetPay,
      description: `Pembayaran payroll ${input.periodLabel}`,
    },
  ];
}
