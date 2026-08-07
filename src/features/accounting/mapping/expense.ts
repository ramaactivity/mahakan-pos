/**
 * mapExpenseCreate — manual expense → journal lines.
 *
 * Per design doc §4.12. CRITICAL: only fires for `sourceType='manual'` —
 * payroll/purchase/refund have their own auto-journal hooks upstream
 * (markPayrollPaid / purchase.confirm / refundTransaction), so skipping these
 * via sourceType filter prevents double-counting.
 *
 * Account resolution priority:
 *   1. expenses.accountId (Owner picks per-expense in form)
 *   2. expense_categories.defaultAccountId (Owner sets per-category once)
 *   3. fallback: 6901 Lain-lain (passed as final fallback by caller)
 *
 * Mapping:
 *   Dr <expense account>             expense.amount
 *      Cr 1101 Kas / 1110 Bank      per paymentMethod
 */

import type { JournalLineInput } from "../posting";

export type ExpensePaymentMethod = "cash" | "transfer" | "other";

export type ExpenseCreateInput = {
  expenseId: string;
  outletId: string;
  /** Date of expense (YYYY-MM-DD WIB). */
  entryDate: string;
  amount: number;
  description: string;
  paymentMethod: ExpensePaymentMethod;
  /** Pre-resolved expense account code (caller priority logic). */
  expenseAccountCode: string;
  /** Sesi AE-69 — kalau staff pilih bank account specific, caller resolve
   * via resolveBankCodeFromDestination(bank.bankName) → pass sebagai
   * override untuk Cr side. Kalau null/undefined, fallback ke hardcoded
   * mapping (cash→1101, transfer→1110, other→1112). */
  cashBankCodeOverride?: string | null;
};

/** Nama metode bayar buat deskripsi jurnal — jangan tulis enum mentah. */
export function expensePaymentLabel(method: ExpensePaymentMethod): string {
  switch (method) {
    case "cash":
      return "tunai";
    case "transfer":
      return "transfer bank";
    case "other":
      return "bank lain";
  }
}

export function expenseCashBankCode(method: ExpensePaymentMethod): string {
  switch (method) {
    case "cash":
      return "1101";
    case "transfer":
      return "1110"; // default Bank BCA
    case "other":
      return "1112"; // Bank Lain-lain (atau Owner override via accountId nanti)
  }
}

export function mapExpenseCreate(
  input: ExpenseCreateInput,
): JournalLineInput[] {
  if (input.amount <= 0) {
    throw new Error("MAP_EXPENSE_NONPOSITIVE");
  }

  const cashBankCode =
    input.cashBankCodeOverride ?? expenseCashBankCode(input.paymentMethod);

  return [
    {
      accountCode: input.expenseAccountCode,
      debit: input.amount,
      description: input.description,
    },
    {
      accountCode: cashBankCode,
      credit: input.amount,
      description: `Uang keluar ${expensePaymentLabel(input.paymentMethod)} — ${input.description}`,
    },
  ];
}
