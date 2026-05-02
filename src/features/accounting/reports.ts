/**
 * Sesi V — Pure compute functions untuk 4 reports:
 *   - Trial Balance
 *   - General Ledger per akun
 *   - Income Statement (Laba Rugi)
 *   - Balance Sheet (Neraca)
 *
 * Inputs: pre-aggregated rows dari queries.ts. Pure transforms ke report
 * shape. Testable as plain functions.
 *
 * Convention: balance angka diserialkan sebagai {debitTotal, creditTotal,
 * netDebit, netCredit} per account. UI memilih sesuai normalBalance.
 */

import type { AccountType, NormalBalance } from "./types";

export type AccountBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
  isContra: boolean;
  parentCode: string | null;
  /** Sum debit dalam range. */
  debitTotal: number;
  /** Sum credit dalam range. */
  creditTotal: number;
};

// ============================================================
// Trial Balance
// ============================================================

export type TrialBalanceRow = {
  code: string;
  name: string;
  type: AccountType;
  /** Net debit (kalau debit-normal-side > credit-side). 0 kalau credit-side dominan. */
  debit: number;
  /** Net credit (kalau credit-side > debit-side). 0 kalau debit-side dominan. */
  credit: number;
};

export type TrialBalanceReport = {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  /** True kalau totalDebit === totalCredit. False = data integrity issue. */
  balanced: boolean;
};

export function buildTrialBalance(
  balances: AccountBalanceRow[],
): TrialBalanceReport {
  const rows: TrialBalanceRow[] = [];
  let totalDebit = 0;
  let totalCredit = 0;

  for (const b of balances) {
    if (b.debitTotal === 0 && b.creditTotal === 0) continue;

    const net = b.debitTotal - b.creditTotal;
    let debit = 0;
    let credit = 0;

    // Determine final side based on normalBalance (kontra-aware).
    // For normalBalance='debit' accounts (asset/cogs/expense + kontra-revenue/contra-equity):
    //   net > 0 = debit balance, net < 0 = credit balance (kasus aneh)
    // For normalBalance='credit' (liability/equity/revenue + kontra-asset):
    //   flip.
    if (b.normalBalance === "debit") {
      // Debit-normal: net > 0 = normal debit balance.
      if (net > 0) debit = net;
      else if (net < 0) credit = -net;
    } else {
      // Credit-normal: net < 0 (credit dominant) = normal credit balance.
      if (net < 0) credit = -net;
      else if (net > 0) debit = net;
    }

    rows.push({
      code: b.code,
      name: b.name,
      type: b.type,
      debit,
      credit,
    });
    totalDebit += debit;
    totalCredit += credit;
  }

  // Sort by code ascending.
  rows.sort((a, b) => a.code.localeCompare(b.code));

  return {
    rows,
    totalDebit,
    totalCredit,
    balanced: totalDebit === totalCredit,
  };
}

// ============================================================
// Income Statement (Laba Rugi)
// ============================================================

export type IncomeStatementSection = {
  label: string;
  items: Array<{ code: string; name: string; amount: number }>;
  subtotal: number;
};

export type IncomeStatementReport = {
  periodLabel: string;
  /** 4xxx normal revenue (excludes contra). */
  revenue: IncomeStatementSection;
  /** 4110/4111 kontra-revenue (subtracted from revenue). */
  revenueContra: IncomeStatementSection;
  netRevenue: number;
  /** 5xxx HPP. */
  cogs: IncomeStatementSection;
  grossProfit: number;
  /** 6xxx beban operasional. */
  expenses: IncomeStatementSection;
  netIncome: number;
};

export function buildIncomeStatement(
  balances: AccountBalanceRow[],
  periodLabel: string,
): IncomeStatementReport {
  const revenue: IncomeStatementSection = {
    label: "Pendapatan",
    items: [],
    subtotal: 0,
  };
  const revenueContra: IncomeStatementSection = {
    label: "Kontra-Pendapatan (Diskon + Refund)",
    items: [],
    subtotal: 0,
  };
  const cogs: IncomeStatementSection = {
    label: "Harga Pokok Penjualan",
    items: [],
    subtotal: 0,
  };
  const expenses: IncomeStatementSection = {
    label: "Beban Operasional",
    items: [],
    subtotal: 0,
  };

  for (const b of balances) {
    if (b.debitTotal === 0 && b.creditTotal === 0) continue;
    const net = Math.abs(b.creditTotal - b.debitTotal);
    if (net === 0) continue;

    if (b.type === "revenue") {
      if (b.isContra) {
        revenueContra.items.push({ code: b.code, name: b.name, amount: net });
        revenueContra.subtotal += net;
      } else {
        revenue.items.push({ code: b.code, name: b.name, amount: net });
        revenue.subtotal += net;
      }
    } else if (b.type === "cogs") {
      cogs.items.push({ code: b.code, name: b.name, amount: net });
      cogs.subtotal += net;
    } else if (b.type === "expense") {
      expenses.items.push({ code: b.code, name: b.name, amount: net });
      expenses.subtotal += net;
    }
  }

  // Sort each section by code ascending.
  for (const s of [revenue, revenueContra, cogs, expenses]) {
    s.items.sort((a, b) => a.code.localeCompare(b.code));
  }

  const netRevenue = revenue.subtotal - revenueContra.subtotal;
  const grossProfit = netRevenue - cogs.subtotal;
  const netIncome = grossProfit - expenses.subtotal;

  return {
    periodLabel,
    revenue,
    revenueContra,
    netRevenue,
    cogs,
    grossProfit,
    expenses,
    netIncome,
  };
}

// ============================================================
// Balance Sheet (Neraca)
// ============================================================

export type BalanceSheetItem = {
  code: string;
  name: string;
  amount: number;
  isContra: boolean;
};

export type BalanceSheetReport = {
  asOfDate: string;
  /** Aset Lancar + Aset Tetap. */
  assets: BalanceSheetItem[];
  totalAssets: number;
  liabilities: BalanceSheetItem[];
  totalLiabilities: number;
  equity: BalanceSheetItem[];
  totalEquity: number;
  /** True kalau assets === liabilities + equity. False = integrity issue. */
  balanced: boolean;
};

export function buildBalanceSheet(
  balances: AccountBalanceRow[],
  asOfDate: string,
  /** Net income period berjalan (current period not yet closed) — auto added
   * ke 3302 Laba Rugi Berjalan kalau provided. Caller can compute via
   * buildIncomeStatement.netIncome dan pass kesini. */
  netIncomeCurrentPeriod = 0,
): BalanceSheetReport {
  const assets: BalanceSheetItem[] = [];
  const liabilities: BalanceSheetItem[] = [];
  const equity: BalanceSheetItem[] = [];

  for (const b of balances) {
    const net = b.debitTotal - b.creditTotal;
    if (net === 0 && b.code !== "3302") continue;

    if (b.type === "asset") {
      // Asset normal-balance debit. Kontra-asset (1290 Akumulasi Penyusutan)
      // = credit-normal, balance reverse.
      const amount = b.isContra ? -net : net;
      // Skip kalau zero (kecuali kontra dengan 0 amount = OK skip).
      if (amount === 0) continue;
      assets.push({
        code: b.code,
        name: b.name,
        amount,
        isContra: b.isContra,
      });
    } else if (b.type === "liability") {
      const amount = -net; // credit-normal, flip sign so positive = liability balance
      if (amount === 0) continue;
      liabilities.push({
        code: b.code,
        name: b.name,
        amount,
        isContra: b.isContra,
      });
    } else if (b.type === "equity") {
      let amount = -net; // credit-normal default
      if (b.isContra) {
        // Prive Owner (3201) is debit-normal kontra. Net positive = debit balance.
        amount = net;
      }
      // Bump 3302 Laba Rugi Berjalan dengan netIncomeCurrentPeriod kalau caller pass.
      if (b.code === "3302") {
        amount += netIncomeCurrentPeriod;
      }
      if (amount === 0 && b.code !== "3302") continue;
      equity.push({
        code: b.code,
        name: b.name,
        amount,
        isContra: b.isContra,
      });
    }
  }

  // Kalau 3302 belum di-list (no journal entry yet) but netIncome != 0, add manually.
  if (
    netIncomeCurrentPeriod !== 0 &&
    !equity.some((e) => e.code === "3302")
  ) {
    equity.push({
      code: "3302",
      name: "Laba Rugi Berjalan",
      amount: netIncomeCurrentPeriod,
      isContra: false,
    });
  }

  for (const s of [assets, liabilities, equity]) {
    s.sort((a, b) => a.code.localeCompare(b.code));
  }

  const totalAssets = assets.reduce((s, a) => s + a.amount, 0);
  const totalLiabilities = liabilities.reduce((s, l) => s + l.amount, 0);
  const totalEquity = equity.reduce((s, e) => s + e.amount, 0);
  // Equity contra accounts (3201 Prive) subtract — but we already store amount as positive
  // for kontra (debit-normal-positive). Actually for proper neraca, kontra equity
  // should show as negative subtotal. Let UI handle display sign.

  return {
    asOfDate,
    assets,
    totalAssets,
    liabilities,
    totalLiabilities,
    equity,
    totalEquity,
    balanced: totalAssets === totalLiabilities + totalEquity,
  };
}

// ============================================================
// General Ledger per Akun
// ============================================================

export type GeneralLedgerEntry = {
  entryNumber: string;
  entryDate: string;
  entryDescription: string;
  lineDescription: string | null;
  debit: number;
  credit: number;
  /** Running balance setelah baris ini diproses. */
  balanceAfter: number;
};

export type GeneralLedgerReport = {
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  /** Saldo awal periode (dari opening balance + entries sebelum range). */
  openingBalance: number;
  entries: GeneralLedgerEntry[];
  closingBalance: number;
};

export function buildGeneralLedger(args: {
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  openingBalance: number;
  entries: Array<{
    entryNumber: string;
    entryDate: string;
    entryDescription: string;
    lineDescription: string | null;
    debit: number;
    credit: number;
  }>;
}): GeneralLedgerReport {
  let balance = args.openingBalance;
  const entries: GeneralLedgerEntry[] = args.entries.map((e) => {
    if (args.normalBalance === "debit") {
      balance = balance + e.debit - e.credit;
    } else {
      balance = balance + e.credit - e.debit;
    }
    return { ...e, balanceAfter: balance };
  });

  return {
    accountCode: args.accountCode,
    accountName: args.accountName,
    accountType: args.accountType,
    normalBalance: args.normalBalance,
    openingBalance: args.openingBalance,
    entries,
    closingBalance: balance,
  };
}
