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
  | "purchase_pay"
  | "purchase_cancel"
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
  | "period_reopen";

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
