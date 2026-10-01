/**
 * Sesi AE-239 — Buku Kas.
 *
 * Pengganti sheet "BUKU KAS" yang dulu diisi owner manual: satu buku per
 * akun kas/bank, isinya diambil dari jurnal (POS, pembelian, gaji, setoran,
 * input Kas, jurnal manual) — tidak ada yang diketik ulang. Murni, tanpa DB.
 */

/** Akun kas & bank = kode 1101–1119 (1120+ piutang). SATU definisi — dipakai
 * Buku Kas dan Laporan Arus Kas. Dulu Arus Kas memakai daftar kode tetap
 * yang tidak memuat 1113 BNI (rekening QRIS sejak AE-219). */
export function isCashBankCode(code: string): boolean {
  return /^11[01]\d$/.test(code) && code !== "1100";
}
/** Padanan SQL untuk kolom kode akun. */
export const CASH_BANK_CODE_SQL_REGEX = "^11[01][0-9]$";

/** Asal transaksi dalam bahasa sehari-hari. */
const SOURCE_LABEL: Record<string, string> = {
  manual: "Jurnal manual",
  opening_balance: "Saldo awal",
  pos_sale: "Penjualan POS",
  pos_daily_sales: "Penjualan POS (harian)",
  pos_refund: "Refund POS",
  pos_void: "Void POS",
  pos_sale_reversal: "Koreksi penjualan",
  pos_sale_correction: "Koreksi penjualan",
  purchase_create: "Pembelian bahan",
  purchase_create_void: "Koreksi pembelian",
  purchase_pay: "Bayar hutang supplier",
  purchase_cancel: "Batal pembelian",
  purchase_pay_reversal: "Koreksi bayar supplier",
  payroll_paid: "Gaji karyawan",
  payroll_paid_reversal: "Koreksi gaji",
  expense_create: "Pengeluaran",
  expense_void: "Batal pengeluaran",
  income_create: "Pemasukan lain",
  income_void: "Batal pemasukan",
  cash_deposit_verified: "Setoran tunai",
  cash_deposit_unverified: "Batal setoran",
  aggregator_settlement: "Pencairan QRIS / online",
  settlement_reclass: "Pindah rekening pencairan",
  shift_variance: "Selisih kas shift",
  shift_variance_reversal: "Koreksi selisih shift",
  capital_injection: "Setoran modal",
  capital_withdrawal: "Tarik modal",
  dividend_distribution: "Bagi dividen",
  dividend_withdrawal: "Pencairan dividen",
  creditor_repayment: "Cicilan kreditur",
  creditor_create: "Pinjaman kreditur",
  share_buyback: "Beli kembali saham",
  internal_debt_expense: "Talangan",
  internal_debt_loan: "Pinjaman internal",
  internal_debt_repayment: "Bayar hutang internal",
  employee_advance_issue: "Kasbon karyawan",
  employee_advance_repayment: "Cicilan kasbon",
  employee_advance_forgive: "Kasbon diputihkan",
  adjusting: "Jurnal penyesuaian",
};

export function cashSourceLabel(sourceType: string): string {
  if (SOURCE_LABEL[sourceType]) return SOURCE_LABEL[sourceType]!;
  if (sourceType.endsWith("_reversal")) return "Koreksi";
  return sourceType.replace(/_/g, " ");
}

export interface CashBookAccount {
  id: string;
  code: string;
  name: string;
}

export interface CashBookCounterpart {
  code: string;
  name: string;
  debit: number;
  credit: number;
}

export interface CashBookRawLine {
  entryId: string;
  entryNumber: string;
  entryDate: string; // YYYY-MM-DD
  sourceType: string;
  description: string;
  lineDescription: string | null;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  /** Semua baris jurnal ini (untuk akun lawan + rincian). */
  entryLines: Array<CashBookCounterpart & { accountId: string }>;
}

export interface CashBookLine {
  entryId: string;
  entryNumber: string;
  entryDate: string;
  source: string;
  description: string;
  /** Akun kas/bank yang bergerak (berguna di mode "Semua"). */
  cashAccount: string;
  /** Akun lawan: sisi seberang jurnal. Kosong = pindah antar kas/bank. */
  counterparts: CashBookCounterpart[];
  isTransfer: boolean;
  masuk: number;
  keluar: number;
  saldo: number;
  entryLines: CashBookCounterpart[];
}

export interface CashBook {
  accounts: CashBookAccount[];
  /** null = semua kas & bank. */
  accountId: string | null;
  from: string;
  to: string;
  openingBalance: number;
  totalIn: number;
  totalOut: number;
  closingBalance: number;
  lines: CashBookLine[];
}

export function buildCashBook(args: {
  accounts: CashBookAccount[];
  accountId: string | null;
  from: string;
  to: string;
  openingBalance: number;
  raw: CashBookRawLine[];
}): CashBook {
  let saldo = args.openingBalance;
  let totalIn = 0;
  let totalOut = 0;
  const lines = args.raw.map((r) => {
    const masuk = r.debit;
    const keluar = r.credit;
    saldo += masuk - keluar;
    totalIn += masuk;
    totalOut += keluar;
    /* Lawan = baris di sisi seberang jurnal (uang masuk → sisi kredit). */
    /* Jurnal penjualan juga memuat pasangan HPP (Dr 5xxx / Cr Persediaan
     * 114x) yang tidak ada hubungannya dengan uang — buang dari akun lawan. */
    const hasCogs = r.entryLines.some((l) => l.code.startsWith("5"));
    const opposite = r.entryLines.filter(
      (l) =>
        l.accountId !== r.accountId &&
        (masuk > 0 ? l.credit > 0 : l.debit > 0) &&
        !l.code.startsWith("5") &&
        !(hasCogs && l.code.startsWith("114")),
    );
    const counterparts = opposite.map(({ code, name, debit, credit }) => ({ code, name, debit, credit }));
    const isTransfer =
      opposite.length > 0 && opposite.every((l) => isCashBankCode(l.code));
    return {
      entryId: r.entryId,
      entryNumber: r.entryNumber,
      entryDate: r.entryDate,
      source: cashSourceLabel(r.sourceType),
      /* Uraian jurnal saja — keterangan baris kas biasanya mengulang uraian
       * yang sama ("Bayar pembelian, Tunai — <supplier>"). */
      description: r.description || r.lineDescription || "",
      cashAccount: `${r.accountCode} ${r.accountName}`,
      counterparts,
      isTransfer,
      masuk,
      keluar,
      saldo,
      entryLines: r.entryLines.map(({ code, name, debit, credit }) => ({ code, name, debit, credit })),
    };
  });
  return {
    accounts: args.accounts,
    accountId: args.accountId,
    from: args.from,
    to: args.to,
    openingBalance: args.openingBalance,
    totalIn,
    totalOut,
    closingBalance: saldo,
    lines,
  };
}
