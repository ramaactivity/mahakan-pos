/**
 * Sesi AE-211 — Tutup Buku Bulanan (closing journal akun nominal).
 *
 * Akun NOMINAL = pendapatan (4xxx), HPP (5xxx), dan beban (6xxx). Saldonya
 * hanya berlaku untuk satu bulan, jadi di akhir bulan disapu habis ke
 * 3302 Laba Rugi Berjalan lalu dipindah ke 3301 Saldo Laba. Akun RIIL
 * (aset / liabilitas / ekuitas) TIDAK ditutup — saldonya lanjut ke bulan
 * berikutnya.
 *
 * File ini bagian murninya: mengubah saldo mentah dari `getAccountBalances`
 * menjadi daftar akun yang akan dinolkan + ringkasan laba rugi. Dipakai DUA
 * kali — sekali untuk pratinjau (tanpa menulis apa pun) dan sekali oleh
 * `closeAccountingPeriod` saat benar-benar menutup buku — supaya angka yang
 * dilihat owner sebelum menekan tombol persis sama dengan yang diposting.
 */

import { isContraRevenueCode } from "./mapping/periodClose";
import type { AccountBalance as PeriodCloseAccountBalance } from "./mapping/periodClose";

/** Bentuk baris yang dikembalikan `getAccountBalances`. */
export type RawAccountBalance = {
  accountId: string;
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "cogs" | "expense";
  normalBalance: "debit" | "credit";
  debitTotal: number;
  creditTotal: number;
};

export type ClosingNominalAccount = {
  accountId: string;
  code: string;
  name: string;
  type: "revenue" | "cogs" | "expense";
  /** true untuk 4110/4111 (diskon & retur penjualan). */
  isContraRevenue: boolean;
  /** Saldo yang akan dinolkan, selalu positif di sisi normalnya. */
  balance: number;
};

export type ClosingSummary = {
  accounts: ClosingNominalAccount[];
  revenueTotal: number;
  contraRevenueTotal: number;
  cogsTotal: number;
  expenseTotal: number;
  /** Pendapatan bersih − HPP − beban. Positif = laba, negatif = rugi. */
  netIncome: number;
};

/**
 * Saring saldo periode ke akun nominal saja, dengan saldo yang sudah
 * dinormalkan (positif = arah normal akunnya). Ini INPUT `mapPeriodClose`,
 * jadi `closeAccountingPeriod` memakai fungsi yang sama dengan pratinjau.
 * Akun bersaldo nol dibuang — tidak ada yang perlu ditutup.
 */
export function collectPeriodCloseBalances(
  balances: RawAccountBalance[],
): PeriodCloseAccountBalance[] {
  const out: PeriodCloseAccountBalance[] = [];
  for (const b of balances) {
    if (b.type !== "revenue" && b.type !== "cogs" && b.type !== "expense") {
      continue;
    }
    const normalized =
      b.normalBalance === "debit"
        ? b.debitTotal - b.creditTotal
        : b.creditTotal - b.debitTotal;
    if (normalized === 0) continue;
    out.push({
      code: b.code,
      type: b.type,
      balance: normalized,
      accountId: b.accountId,
    });
  }
  return out;
}

/**
 * Ringkasan untuk layar Tutup Buku: daftar akun nominal yang akan dinolkan
 * plus total per kelompok dan laba/rugi bersihnya.
 *
 * Catatan tanda: `collectPeriodCloseBalances` sudah menormalkan saldo ke arah
 * normal akun, jadi saldo NEGATIF di sini berarti akunnya terbalik dari
 * kelaziman (mis. beban bersaldo kredit karena banyak koreksi). Angka itu
 * tetap ditampilkan apa adanya — bukan diabaikan — supaya kejanggalannya
 * kelihatan sebelum buku ditutup.
 */
export function summarizeClosingNominals(
  balances: RawAccountBalance[],
): ClosingSummary {
  const nominals = collectPeriodCloseBalances(balances);
  const nameByCode = new Map(balances.map((b) => [b.code, b.name]));

  const accounts: ClosingNominalAccount[] = nominals
    .map((n) => ({
      accountId: n.accountId,
      code: n.code,
      name: nameByCode.get(n.code) ?? n.code,
      type: n.type as "revenue" | "cogs" | "expense",
      isContraRevenue: n.type === "revenue" && isContraRevenueCode(n.code),
      balance: n.balance,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  let revenueTotal = 0;
  let contraRevenueTotal = 0;
  let cogsTotal = 0;
  let expenseTotal = 0;
  for (const a of accounts) {
    if (a.type === "revenue") {
      if (a.isContraRevenue) contraRevenueTotal += a.balance;
      else revenueTotal += a.balance;
    } else if (a.type === "cogs") {
      cogsTotal += a.balance;
    } else {
      expenseTotal += a.balance;
    }
  }

  return {
    accounts,
    revenueTotal,
    contraRevenueTotal,
    cogsTotal,
    expenseTotal,
    netIncome: revenueTotal - contraRevenueTotal - cogsTotal - expenseTotal,
  };
}

/**
 * Cek keseimbangan buku sepanjang periode: total debit vs total kredit SEMUA
 * akun. Kalau timpang, ada jurnal yang rusak dan tutup buku akan mengunci
 * angka yang salah — jadi ini muncul sebagai peringatan di layar.
 */
export function periodBalanceCheck(balances: RawAccountBalance[]): {
  totalDebit: number;
  totalCredit: number;
  diff: number;
  balanced: boolean;
} {
  let totalDebit = 0;
  let totalCredit = 0;
  for (const b of balances) {
    totalDebit += b.debitTotal;
    totalCredit += b.creditTotal;
  }
  return {
    totalDebit,
    totalCredit,
    diff: totalDebit - totalCredit,
    balanced: totalDebit === totalCredit,
  };
}

/** "Juni 2026" dari (2026, 6). */
const MONTH_NAMES_ID = [
  "",
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

export function periodLabelId(year: number, month: number): string {
  return `${MONTH_NAMES_ID[month] ?? month} ${year}`;
}

/**
 * Hari pertama & terakhir periode dalam kalender WIB (YYYY-MM-DD).
 *
 * Audit AE-186 — WAJIB memakai `Date.UTC`: `new Date(y, m, 0)` memakai
 * tengah malam waktu lokal, dan pada server non-UTC `toISOString()` menggeser
 * hasilnya mundur satu hari sehingga jurnal tanggal 31 lolos dari sapuan.
 */
export function periodBounds(
  year: number,
  month: number,
): { firstDay: string; lastDay: string } {
  return {
    firstDay: `${year}-${String(month).padStart(2, "0")}-01`,
    lastDay: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
}
