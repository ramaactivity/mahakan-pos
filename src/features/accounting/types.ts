import type { InferSelectModel } from "drizzle-orm";
import type {
  chartOfAccounts,
  accountingPeriods,
  journalEntries,
  journalLines,
} from "@/db/schema";

// ---------- Drizzle-derived row types ----------

export type ChartOfAccount = InferSelectModel<typeof chartOfAccounts>;
export type AccountingPeriod = InferSelectModel<typeof accountingPeriods>;
export type JournalEntry = InferSelectModel<typeof journalEntries>;
export type JournalLine = InferSelectModel<typeof journalLines>;

// ---------- Enum unions (mirrors of pgEnum string sets) ----------

export type AccountType =
  | "asset"
  | "liability"
  | "equity"
  | "revenue"
  | "cogs"
  | "expense";

export type NormalBalance = "debit" | "credit";

export type PeriodStatus = "open" | "closed" | "locked";

export type JournalSourceType =
  | "manual"
  | "opening_balance"
  | "pos_sale"
  | "pos_refund"
  | "pos_void"
  | "pos_compliment"
  | "purchase_create"
  /* Sesi AE-188 — pembalik jurnal GR saat PO diedit (alur harga Rp 0 dulu
   * supaya PIC Operasional bisa proses GR, harga diisi saat nota datang). */
  | "purchase_create_void"
  | "purchase_pay"
  | "purchase_cancel"
  /* Audit AE-181 — reversal jurnal pembayaran saat cancel purchase paid. */
  | "purchase_pay_reversal"
  | "payroll_paid"
  | "expense_create"
  | "expense_void"
  | "income_create"
  | "income_void"
  | "cash_deposit_verified"
  | "cash_deposit_unverified"
  | "aggregator_settlement"
  | "shift_variance_reversal"
  | "shift_variance"
  | "opname_adjustment"
  | "period_close"
  | "period_reopen"
  /* Sesi AE-62r — per-transaction correction (paymentMethod/total swap). */
  | "pos_sale_reversal"
  | "pos_sale_correction"
  /* Sesi AE-63 — Investor / Pengelola modal & dividen flows. */
  | "capital_injection"
  | "capital_withdrawal"
  | "dividend_distribution"
  /* Sesi AE-80 — Modal & Dividen v2 (ledger / mutasi dinamis). */
  | "dividend_distribution_reversal"
  | "dividend_withdrawal"
  | "dividend_withdrawal_reversal"
  | "creditor_repayment"
  | "creditor_repayment_reversal"
  /* Audit AE-181 — jurnal pengakuan hutang saat kreditur dibuat/diimport. */
  | "creditor_create"
  | "share_buyback"
  | "share_buyback_reversal"
  /* Sesi AE-80 follow-up — convert investor → kreditur. */
  | "investor_to_creditor_conversion"
  /* Sesi AE-180 — Hutang Internal (Talangan Owner/Pengelola). */
  | "internal_debt_expense"
  | "internal_debt_loan"
  | "internal_debt_entry_reversal"
  | "internal_debt_repayment"
  | "internal_debt_repayment_reversal"
  /* Sesi AE-116 — COGS period close adjustment (reconcile recognized vs actual). */
  | "cogs_period_close";

export type JournalEntryStatus = "draft" | "posted" | "reversed";

// ---------- ApiResult helpers (matches finance/cash patterns) ----------

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

export function fail(code: string, message: string): ApiResult<never> {
  return { ok: false, error: { code, message } };
}

// ---------- Action inputs ----------

export type CreateAccountInput = {
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
  parentCode?: string | null;
  isContra?: boolean;
  displayOrder?: number;
  notes?: string | null;
};

export type UpdateAccountInput = {
  id: string;
  name?: string;
  parentCode?: string | null;
  displayOrder?: number;
  notes?: string | null;
  isActive?: boolean;
};

// ---------- View shapes (queries return) ----------

export type AccountListRow = ChartOfAccount;

export type JournalEntryWithLines = JournalEntry & {
  lines: (JournalLine & {
    accountCode: string;
    accountName: string;
  })[];
  /** Display shorthand: "JE-202606-0001". Same as entry.entryNumber but explicit for UI. */
  number: string;
};

export type PeriodSummary = AccountingPeriod & {
  /** Number of journal entries di period (status='posted' atau 'draft'). */
  entryCount: number;
};
