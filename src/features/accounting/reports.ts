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
// Ringkasan Saldo per Akun (Buku Besar — tampilan sebelum pilih akun)
// ============================================================

/**
 * Sesi AE-183 — permintaan owner: sebelum memilih akun di Buku Besar, area
 * kosong di bawah filter menampilkan TOTAL PER AKUN seperti Neraca, dan tiap
 * baris bisa diklik untuk langsung membuka detail buku besar akun itu.
 *
 * Beda dengan Trial Balance: di sini tiap akun ditampilkan lengkap dengan
 * saldo awal → mutasi (debit/kredit) → saldo akhir, jadi angkanya nyambung
 * persis dengan tampilan detail per akun. Trial Balance hanya menampilkan
 * saldo bersih satu sisi tanpa saldo awal.
 */
export type LedgerSummaryRow = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
  isContra: boolean;
  /** Saldo sebelum periode, sudah bertanda sesuai normalBalance. */
  openingBalance: number;
  /** Mutasi dalam periode. */
  debitTotal: number;
  creditTotal: number;
  /** openingBalance + mutasi (bertanda sesuai normalBalance). */
  closingBalance: number;
};

export type LedgerSummaryGroup = {
  type: AccountType;
  label: string;
  rows: LedgerSummaryRow[];
  totalDebit: number;
  totalCredit: number;
  totalClosing: number;
};

export type LedgerAccountSummaryReport = {
  groups: LedgerSummaryGroup[];
  totalDebit: number;
  totalCredit: number;
  /** True kalau total debit === total kredit (kontrol keseimbangan mutasi). */
  balanced: boolean;
  /** Jumlah akun aktif yang disembunyikan karena nol total (tanpa mutasi & tanpa saldo). */
  hiddenEmptyAccounts: number;
};

const LEDGER_GROUP_ORDER: AccountType[] = [
  "asset",
  "liability",
  "equity",
  "revenue",
  "cogs",
  "expense",
];

const LEDGER_GROUP_LABEL: Record<AccountType, string> = {
  asset: "Aset",
  liability: "Kewajiban",
  equity: "Ekuitas",
  revenue: "Pendapatan",
  cogs: "Harga Pokok Penjualan",
  expense: "Beban",
};

/** Mutasi bertanda sesuai sisi normal akun (mirror buildGeneralLedger). */
function signedMovement(
  normalBalance: NormalBalance,
  debit: number,
  credit: number,
): number {
  return normalBalance === "debit" ? debit - credit : credit - debit;
}

export function buildLedgerAccountSummary(args: {
  /** Mutasi SEBELUM tanggal mulai — dipakai sebagai saldo awal. */
  opening: AccountBalanceRow[];
  /** Mutasi DALAM periode. */
  movement: AccountBalanceRow[];
}): LedgerAccountSummaryReport {
  const openingByAccount = new Map<string, number>();
  for (const o of args.opening) {
    openingByAccount.set(
      o.accountId,
      signedMovement(o.normalBalance, o.debitTotal, o.creditTotal),
    );
  }

  const byType = new Map<AccountType, LedgerSummaryRow[]>();
  let totalDebit = 0;
  let totalCredit = 0;
  let hiddenEmptyAccounts = 0;

  for (const m of args.movement) {
    const openingBalance = openingByAccount.get(m.accountId) ?? 0;
    const closingBalance =
      openingBalance +
      signedMovement(m.normalBalance, m.debitTotal, m.creditTotal);

    /* Sembunyikan akun yang benar-benar kosong (tidak ada saldo awal, tidak
     * ada mutasi, saldo akhir nol) supaya daftar tidak penuh baris nol —
     * jumlahnya tetap dilaporkan lewat hiddenEmptyAccounts. */
    if (
      openingBalance === 0 &&
      m.debitTotal === 0 &&
      m.creditTotal === 0 &&
      closingBalance === 0
    ) {
      hiddenEmptyAccounts += 1;
      continue;
    }

    const row: LedgerSummaryRow = {
      accountId: m.accountId,
      code: m.code,
      name: m.name,
      type: m.type,
      normalBalance: m.normalBalance,
      isContra: m.isContra,
      openingBalance,
      debitTotal: m.debitTotal,
      creditTotal: m.creditTotal,
      closingBalance,
    };
    const bucket = byType.get(m.type);
    if (bucket) bucket.push(row);
    else byType.set(m.type, [row]);

    totalDebit += m.debitTotal;
    totalCredit += m.creditTotal;
  }

  const groups: LedgerSummaryGroup[] = [];
  for (const type of LEDGER_GROUP_ORDER) {
    const rows = byType.get(type);
    if (!rows || rows.length === 0) continue;
    rows.sort((a, b) => a.code.localeCompare(b.code));
    groups.push({
      type,
      label: LEDGER_GROUP_LABEL[type],
      rows,
      totalDebit: rows.reduce((s, r) => s + r.debitTotal, 0),
      totalCredit: rows.reduce((s, r) => s + r.creditTotal, 0),
      totalClosing: rows.reduce((s, r) => s + r.closingBalance, 0),
    });
  }

  return {
    groups,
    totalDebit,
    totalCredit,
    balanced: totalDebit === totalCredit,
    hiddenEmptyAccounts,
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
    // Sesi AE-62g — preserve sign sesuai normal-balance per account type.
    // Sebelumnya pakai Math.abs() → reversed-balance accounts (e.g. revenue
    // dengan debit balance) tampil positif → audit trail rusak, P&L sign
    // ambiguous. Sekarang signed seperti Trial Balance.
    //
    // Normal balance:
    //   revenue: credit (credit > debit = positive)
    //   cogs:    debit (debit > credit = positive)
    //   expense: debit (debit > credit = positive)
    // Contra-revenue (returns, discounts): debit normal → flip kembali.
    const creditNet = b.creditTotal - b.debitTotal; // credit-positive
    const debitNet = b.debitTotal - b.creditTotal;  // debit-positive
    const net =
      b.type === "revenue"
        ? b.isContra
          ? debitNet  // contra-revenue normal di sisi debit
          : creditNet
        : debitNet;   // cogs + expense normal debit
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
  /* Sesi AE-106 — contra equity (Prive Owner 3201) HARUS di-subtract dari
   * totalEquity. Pre-fix bug: stored amount positive (per debit-normal
   * convention untuk row display "(-) Prive Rp X"), tapi reduce treat
   * as additive → totalEquity over-stated → Neraca drift.
   *
   * Asset side sudah handle isContra via `amount = b.isContra ? -net : net`
   * pada line 257 — itu menghasilkan signed amount yang langsung correct
   * untuk sum. Equity side beda: stored as positive untuk display, jadi
   * sum harus eksplisit negate untuk contra.
   */
  const totalEquity = equity.reduce(
    (s, e) => s + (e.isContra ? -e.amount : e.amount),
    0,
  );

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
// Cash Flow Statement (PSAK Standar — Operating/Investing/Financing)
// ============================================================

/**
 * Cash Flow Statement classifies cash inflows + outflows ke 3 kategori
 * standar (PSAK / IFRS):
 *
 *   - Operating: POS sales, refund, purchase, payroll, expense, income,
 *     aggregator settlement, shift variance — kegiatan rutin operasional
 *   - Investing: fixed asset capitalization, sale of asset — capex
 *   - Financing: modal owner setoran, prive owner withdrawal — equity
 *
 * Reconciliation: opening_cash + net_change_in_cash === closing_cash_actual.
 * `matchesActualClosing` flag = data integrity check (must = true kalau ledger
 * benar).
 *
 * Data source: journal_lines yang account in (1101, 1102, 1110, 1111, 1112).
 * Caller pre-aggregates per (sourceType, section) + checks counter-account
 * untuk classify manual entries.
 */

export type CashFlowItem = {
  /** Display label (e.g. "POS sale", "Manual journal", etc.). */
  label: string;
  /** Net cash impact in period (positive = inflow, negative = outflow). */
  amount: number;
  /** Number of journal entries contributing. */
  entryCount: number;
};

export type CashFlowSection = {
  label: string;
  items: CashFlowItem[];
  netCash: number;
};

export type CashFlowStatement = {
  periodLabel: string;
  openingCash: number;
  operating: CashFlowSection;
  investing: CashFlowSection;
  financing: CashFlowSection;
  netChangeInCash: number;
  closingCashComputed: number;
  closingCashActual: number;
  /** abs(closingCashComputed - closingCashActual) < 100 (rounding tolerance). */
  matchesActualClosing: boolean;
};

/** Inputs untuk buildCashFlowStatement — caller pre-classifies. */
export type CashFlowEntryAggregate = {
  /** "operating" | "investing" | "financing" — caller classifies. */
  bucket: "operating" | "investing" | "financing";
  /** Display label biasanya derived dari sourceType. */
  label: string;
  /** Net cash impact (signed). */
  amount: number;
  /** Entry count. */
  entryCount: number;
};

export const SOURCE_TYPE_LABELS_CF: Record<string, string> = {
  pos_sale: "POS Cash Sales",
  pos_refund: "Refund Payouts",
  purchase_create: "Purchase Payments (cash)",
  purchase_pay: "Purchase Payments (TOP paid)",
  purchase_cancel: "Purchase Cancellation",
  payroll_paid: "Payroll Payments",
  expense_create: "Operating Expenses",
  income_create: "Non-POS Income",
  aggregator_settlement: "Aggregator Settlements",
  shift_variance: "Shift Cash Variance",
  manual_operating: "Manual Journal (Operating)",
  manual_investing: "Fixed Asset Capitalization",
  manual_financing: "Owner Modal / Prive",
};

export function classifyCashFlowSourceType(
  sourceType: string,
): "operating" | "investing" | "financing" | "skip" {
  switch (sourceType) {
    case "pos_sale":
    case "pos_refund":
    case "purchase_create":
    case "purchase_pay":
    case "purchase_cancel":
    case "payroll_paid":
    case "expense_create":
    case "income_create":
    case "aggregator_settlement":
    case "shift_variance":
      return "operating";
    case "cash_deposit_verified": // intra-cash transfer (kas → bank), no net cash change
    case "pos_compliment": // no cash movement
    case "opname_adjustment": // no cash movement
    case "period_close":
    case "period_reopen":
    case "opening_balance": // pre-period, baseline
    case "expense_void":
    case "income_void":
      return "skip";
    case "manual":
      // Caller must sub-classify based on counter-account.
      return "operating"; // default fallback
    default:
      return "operating"; // unknown sourceType → operating bucket
  }
}

export function buildCashFlowStatement(args: {
  periodLabel: string;
  openingCash: number;
  closingCashActual: number;
  entries: CashFlowEntryAggregate[];
}): CashFlowStatement {
  const operating: CashFlowSection = {
    label: "Arus Kas dari Aktivitas Operasi",
    items: [],
    netCash: 0,
  };
  const investing: CashFlowSection = {
    label: "Arus Kas dari Aktivitas Investasi",
    items: [],
    netCash: 0,
  };
  const financing: CashFlowSection = {
    label: "Arus Kas dari Aktivitas Pendanaan",
    items: [],
    netCash: 0,
  };

  // Aggregate items per label within each bucket (caller may emit multiple
  // rows untuk same label e.g. operating manual + manual_operating).
  const buckets = {
    operating,
    investing,
    financing,
  };
  for (const e of args.entries) {
    if (e.amount === 0) continue;
    const bucket = buckets[e.bucket];
    const existing = bucket.items.find((it) => it.label === e.label);
    if (existing) {
      existing.amount += e.amount;
      existing.entryCount += e.entryCount;
    } else {
      bucket.items.push({
        label: e.label,
        amount: e.amount,
        entryCount: e.entryCount,
      });
    }
    bucket.netCash += e.amount;
  }

  // Sort items by absolute amount descending untuk display.
  for (const b of [operating, investing, financing]) {
    b.items.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  }

  const netChange = operating.netCash + investing.netCash + financing.netCash;
  const closingComputed = args.openingCash + netChange;

  return {
    periodLabel: args.periodLabel,
    openingCash: args.openingCash,
    operating,
    investing,
    financing,
    netChangeInCash: netChange,
    closingCashComputed: closingComputed,
    closingCashActual: args.closingCashActual,
    matchesActualClosing:
      Math.abs(closingComputed - args.closingCashActual) < 100,
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

// ============================================================
// Validation Report — Ledger vs Source Drift Check
// ============================================================

/**
 * Sesi W (Field Validation) — compares accounting ledger balances vs source
 * data dari Finance module + ingredient stock + purchases. Used during
 * post-cutover monitoring untuk detect drift kalau auto-journal hooks bug
 * atau kalau Owner forgot post manual entry.
 *
 * 3 trustworthy validations (high signal):
 *   - Kas Tunai (1101 + 1102) vs Finance getCashOnHand snapshot
 *   - Persediaan (1140 + 1141 + 1142) vs sum ingredients × cost grouped section
 *   - Hutang Dagang (2101) vs sum purchases status='pending_payment'
 *
 * Bank + P&L validation skipped — bank reconciliation needs bank statement
 * (manual), P&L cross-check Owner does visually via Reports tab + Finance Arus Kas.
 */
export type ValidationRow = {
  label: string;
  /** Account codes that contribute (display only). */
  accountCodes: string[];
  ledgerAmount: number;
  sourceAmount: number;
  diff: number;
  /** "ok" kalau diff = 0, "warning" kalau ≤ 1% threshold (rounding), "critical" kalau > 1%. */
  status: "ok" | "warning" | "critical";
  /** Optional human note kalau drift terdeteksi. */
  note?: string;
};

export type ValidationReport = {
  asOfDate: string;
  rows: ValidationRow[];
  /** True kalau semua row status='ok'. */
  allClean: boolean;
};

const WARNING_THRESHOLD_PCT = 0.01; // 1%

function classifyDrift(
  ledger: number,
  source: number,
): { diff: number; status: ValidationRow["status"] } {
  const diff = ledger - source;
  if (diff === 0) return { diff: 0, status: "ok" };
  // Avoid divide-by-zero. Large absolute drift on near-zero numbers = critical.
  const base = Math.max(Math.abs(ledger), Math.abs(source));
  if (base === 0) return { diff, status: "critical" };
  const pct = Math.abs(diff) / base;
  return {
    diff,
    status: pct <= WARNING_THRESHOLD_PCT ? "warning" : "critical",
  };
}

export function buildValidationReport(args: {
  asOfDate: string;
  ledger: {
    kasTunai: number;             // 1101 + 1102
    persediaanKitchen: number;    // 1140
    persediaanBar: number;        // 1141
    persediaanPendukung: number;  // 1142
    hutangDagang: number;         // 2101
  };
  source: {
    cashOnHand: number;           // dari getCashOnHand
    persediaanKitchen: number;    // sum kitchen ingredients × cost
    persediaanBar: number;        // sum bar ingredients × cost
    persediaanPendukung: number;  // sum supporting/cleaning ingredients × cost
    hutangDagangPending: number;  // sum purchases pending_payment
  };
}): ValidationReport {
  const rows: ValidationRow[] = [];

  // Kas Tunai
  {
    const { diff, status } = classifyDrift(
      args.ledger.kasTunai,
      args.source.cashOnHand,
    );
    rows.push({
      label: "Kas Tunai",
      accountCodes: ["1101", "1102"],
      ledgerAmount: args.ledger.kasTunai,
      sourceAmount: args.source.cashOnHand,
      diff,
      status,
      note:
        status === "critical"
          ? "Drift signifikan vs Finance Cash-on-Hand. Cek apakah ada setoran tunai belum verified atau shift variance hook gak fire."
          : status === "warning"
            ? "Drift kecil — kemungkinan rounding atau cash variance kecil yang belum ter-jurnal."
            : undefined,
    });
  }

  // Persediaan Kitchen
  {
    const { diff, status } = classifyDrift(
      args.ledger.persediaanKitchen,
      args.source.persediaanKitchen,
    );
    rows.push({
      label: "Persediaan Kitchen",
      accountCodes: ["1140"],
      ledgerAmount: args.ledger.persediaanKitchen,
      sourceAmount: args.source.persediaanKitchen,
      diff,
      status,
      note:
        status === "critical"
          ? "Drift signifikan vs ingredients section='kitchen' × cost. Cek opname/purchase/recipe hooks."
          : status === "warning"
            ? "Drift kecil — rounding or minor opname adjustment."
            : undefined,
    });
  }

  // Persediaan Bar
  {
    const { diff, status } = classifyDrift(
      args.ledger.persediaanBar,
      args.source.persediaanBar,
    );
    rows.push({
      label: "Persediaan Bar",
      accountCodes: ["1141"],
      ledgerAmount: args.ledger.persediaanBar,
      sourceAmount: args.source.persediaanBar,
      diff,
      status,
      note:
        status === "critical"
          ? "Drift signifikan vs ingredients section='bar' × cost."
          : undefined,
    });
  }

  // Persediaan Pendukung
  {
    const { diff, status } = classifyDrift(
      args.ledger.persediaanPendukung,
      args.source.persediaanPendukung,
    );
    rows.push({
      label: "Persediaan Pendukung",
      accountCodes: ["1142"],
      ledgerAmount: args.ledger.persediaanPendukung,
      sourceAmount: args.source.persediaanPendukung,
      diff,
      status,
      note:
        status === "critical"
          ? "Drift signifikan vs ingredients section IN ('supporting','cleaning') × cost."
          : undefined,
    });
  }

  // Hutang Dagang
  {
    const { diff, status } = classifyDrift(
      args.ledger.hutangDagang,
      args.source.hutangDagangPending,
    );
    rows.push({
      label: "Hutang Dagang (TOP)",
      accountCodes: ["2101"],
      ledgerAmount: args.ledger.hutangDagang,
      sourceAmount: args.source.hutangDagangPending,
      diff,
      status,
      note:
        status === "critical"
          ? "Drift signifikan vs sum purchases pending_payment. Cek apakah ada purchase create/pay/cancel hook belum fire atau purchase status manual diubah."
          : status === "warning"
            ? "Drift kecil — kemungkinan rounding."
            : undefined,
    });
  }

  return {
    asOfDate: args.asOfDate,
    rows,
    allClean: rows.every((r) => r.status === "ok"),
  };
}

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
