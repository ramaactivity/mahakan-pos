/**
 * Sesi Y polish — CSV exporters for accounting reports.
 *
 * Companion to PDF exports — CSV cocok untuk slice di Excel/Google Sheets,
 * share ke akuntan eksternal yang lebih nyaman manipulate spreadsheet.
 *
 * Pattern follows existing menu-engineering-csv.ts: papaparse unparse +
 * Blob download. UTF-8 BOM untuk Excel locale (id-ID separator).
 */
import Papa from "papaparse";
import type {
  BalanceSheetReport,
  CashFlowStatement,
  GeneralLedgerReport,
  IncomeStatementReport,
  TrialBalanceReport,
} from "@/features/accounting/reports";

/** Trigger browser download for in-memory CSV string. UTF-8 BOM prepended
 * supaya Excel id-ID locale buka dengan separator benar. */
export function downloadCsv(filename: string, content: string): void {
  // ﻿ = BOM signal Excel buka as UTF-8
  const blob = new Blob(["﻿" + content], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================
// Trial Balance CSV
// ============================================================

export function buildTrialBalanceCsv(report: TrialBalanceReport): string {
  type CsvRow = {
    Kode: string;
    Akun: string;
    Tipe: string;
    Debit: number;
    Credit: number;
  };
  const data: CsvRow[] = report.rows.map((r) => ({
    Kode: r.code,
    Akun: r.name,
    Tipe: r.type,
    Debit: r.debit,
    Credit: r.credit,
  }));
  // Append totals row
  data.push({
    Kode: "",
    Akun: "TOTAL",
    Tipe: "",
    Debit: report.totalDebit,
    Credit: report.totalCredit,
  });
  data.push({
    Kode: "",
    Akun: report.balanced ? "BALANCED" : "TIDAK BALANCE",
    Tipe: "",
    Debit: 0,
    Credit: report.totalDebit - report.totalCredit,
  });
  return Papa.unparse(data, { newline: "\n" });
}

// ============================================================
// Income Statement CSV
// ============================================================

export function buildIncomeStatementCsv(
  report: IncomeStatementReport,
): string {
  type Row = {
    Section: string;
    Kode: string;
    Akun: string;
    Amount: number;
  };
  const rows: Row[] = [];

  for (const item of report.revenue.items) {
    rows.push({
      Section: report.revenue.label,
      Kode: item.code,
      Akun: item.name,
      Amount: item.amount,
    });
  }
  rows.push({
    Section: report.revenue.label,
    Kode: "",
    Akun: "Subtotal",
    Amount: report.revenue.subtotal,
  });

  for (const item of report.revenueContra.items) {
    rows.push({
      Section: report.revenueContra.label,
      Kode: item.code,
      Akun: item.name,
      Amount: -item.amount,
    });
  }
  if (report.revenueContra.items.length > 0) {
    rows.push({
      Section: report.revenueContra.label,
      Kode: "",
      Akun: "Subtotal",
      Amount: -report.revenueContra.subtotal,
    });
  }

  rows.push({
    Section: "PENDAPATAN BERSIH",
    Kode: "",
    Akun: "Net Revenue",
    Amount: report.netRevenue,
  });

  for (const item of report.cogs.items) {
    rows.push({
      Section: report.cogs.label,
      Kode: item.code,
      Akun: item.name,
      Amount: -item.amount,
    });
  }
  rows.push({
    Section: report.cogs.label,
    Kode: "",
    Akun: "Subtotal",
    Amount: -report.cogs.subtotal,
  });

  rows.push({
    Section: "LABA KOTOR",
    Kode: "",
    Akun: "Gross Profit",
    Amount: report.grossProfit,
  });

  for (const item of report.expenses.items) {
    rows.push({
      Section: report.expenses.label,
      Kode: item.code,
      Akun: item.name,
      Amount: -item.amount,
    });
  }
  rows.push({
    Section: report.expenses.label,
    Kode: "",
    Akun: "Subtotal",
    Amount: -report.expenses.subtotal,
  });

  rows.push({
    Section: "LABA / RUGI BERSIH",
    Kode: "",
    Akun: "Net Income",
    Amount: report.netIncome,
  });

  return Papa.unparse(rows, { newline: "\n" });
}

// ============================================================
// Balance Sheet CSV
// ============================================================

export function buildBalanceSheetCsv(report: BalanceSheetReport): string {
  type Row = {
    Section: string;
    Kode: string;
    Akun: string;
    Amount: number;
  };
  const rows: Row[] = [];

  for (const a of report.assets) {
    rows.push({
      Section: "ASET",
      Kode: a.code,
      Akun: a.isContra ? `(-) ${a.name}` : a.name,
      Amount: a.amount,
    });
  }
  rows.push({
    Section: "ASET",
    Kode: "",
    Akun: "TOTAL ASET",
    Amount: report.totalAssets,
  });

  for (const l of report.liabilities) {
    rows.push({
      Section: "KEWAJIBAN",
      Kode: l.code,
      Akun: l.name,
      Amount: l.amount,
    });
  }
  rows.push({
    Section: "KEWAJIBAN",
    Kode: "",
    Akun: "Subtotal",
    Amount: report.totalLiabilities,
  });

  for (const e of report.equity) {
    rows.push({
      Section: "EKUITAS",
      Kode: e.code,
      Akun: e.isContra ? `(-) ${e.name}` : e.name,
      Amount: e.amount,
    });
  }
  rows.push({
    Section: "EKUITAS",
    Kode: "",
    Akun: "Subtotal",
    Amount: report.totalEquity,
  });

  rows.push({
    Section: "TOTAL",
    Kode: "",
    Akun: "TOTAL KEWAJIBAN + EKUITAS",
    Amount: report.totalLiabilities + report.totalEquity,
  });

  return Papa.unparse(rows, { newline: "\n" });
}

// ============================================================
// Cash Flow Statement CSV
// ============================================================

export function buildCashFlowStatementCsv(
  report: CashFlowStatement,
): string {
  type Row = {
    Section: string;
    Item: string;
    Amount: number;
    EntryCount: number;
  };
  const rows: Row[] = [];

  rows.push({
    Section: "Saldo Awal",
    Item: "Saldo Kas Awal",
    Amount: report.openingCash,
    EntryCount: 0,
  });

  for (const it of report.operating.items) {
    rows.push({
      Section: report.operating.label,
      Item: it.label,
      Amount: it.amount,
      EntryCount: it.entryCount,
    });
  }
  rows.push({
    Section: report.operating.label,
    Item: "Net Operating",
    Amount: report.operating.netCash,
    EntryCount: 0,
  });

  for (const it of report.investing.items) {
    rows.push({
      Section: report.investing.label,
      Item: it.label,
      Amount: it.amount,
      EntryCount: it.entryCount,
    });
  }
  rows.push({
    Section: report.investing.label,
    Item: "Net Investing",
    Amount: report.investing.netCash,
    EntryCount: 0,
  });

  for (const it of report.financing.items) {
    rows.push({
      Section: report.financing.label,
      Item: it.label,
      Amount: it.amount,
      EntryCount: it.entryCount,
    });
  }
  rows.push({
    Section: report.financing.label,
    Item: "Net Financing",
    Amount: report.financing.netCash,
    EntryCount: 0,
  });

  rows.push({
    Section: "Summary",
    Item: "Perubahan Bersih Kas",
    Amount: report.netChangeInCash,
    EntryCount: 0,
  });
  rows.push({
    Section: "Summary",
    Item: "Saldo Kas Akhir (Computed)",
    Amount: report.closingCashComputed,
    EntryCount: 0,
  });
  rows.push({
    Section: "Summary",
    Item: "Saldo Kas Akhir (Aktual)",
    Amount: report.closingCashActual,
    EntryCount: 0,
  });

  return Papa.unparse(rows, { newline: "\n" });
}

// ============================================================
// General Ledger per Akun CSV
// ============================================================

export function buildGeneralLedgerCsv(report: GeneralLedgerReport): string {
  type Row = {
    Tanggal: string;
    EntryNumber: string;
    Description: string;
    Debit: number;
    Credit: number;
    Balance: number;
  };
  const rows: Row[] = [];

  rows.push({
    Tanggal: "",
    EntryNumber: "OPENING",
    Description: `Saldo awal — ${report.accountCode} ${report.accountName}`,
    Debit: 0,
    Credit: 0,
    Balance: report.openingBalance,
  });

  for (const e of report.entries) {
    rows.push({
      Tanggal: e.entryDate,
      EntryNumber: e.entryNumber,
      Description: e.lineDescription ?? e.entryDescription,
      Debit: e.debit,
      Credit: e.credit,
      Balance: e.balanceAfter,
    });
  }

  rows.push({
    Tanggal: "",
    EntryNumber: "CLOSING",
    Description: `Saldo akhir — ${report.accountCode} ${report.accountName}`,
    Debit: 0,
    Credit: 0,
    Balance: report.closingBalance,
  });

  return Papa.unparse(rows, { newline: "\n" });
}
