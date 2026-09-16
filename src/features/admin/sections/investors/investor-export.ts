"use client";

/**
 * Sesi AE-231 — unduh SELURUH data modul Modal & Dividen jadi satu berkas
 * Excel yang enak dibaca dan diedit.
 *
 * Datanya diambil lewat action yang sudah dipakai layar, bukan action ekspor
 * baru: isinya persis sama dengan yang dilihat owner, dan tidak ada query
 * kedua yang harus ikut dijaga kalau bentuk datanya berubah.
 */

import {
  downloadStyledXlsx,
  type StyledCol,
  type StyledSheet,
} from "@/lib/xlsx-styled";
import { todayJakarta } from "@/lib/tz";
import { listInvestors, isOk as investorOk } from "@/features/investors";
import { listPengelola, isOk as pengelolaOk } from "@/features/pengelola";
import {
  fetchShareTransactions,
  isOk as shareOk,
} from "@/features/share-transactions";
import { fetchWithdrawals, isOk as wdOk } from "@/features/withdrawals";
import { fetchCreditors, isOk as creditorOk } from "@/features/creditors";
import {
  listDistributions,
  isOk as distOk,
} from "@/features/profit-distributions";

const STATUS_LABEL: Record<string, string> = {
  active: "Aktif",
  inactive: "Tidak aktif",
  exited: "Keluar",
  settled: "Lunas",
  defaulted: "Macet",
  posted: "Diposting",
  reversed: "Dibatalkan",
  draft: "Draf",
  approved: "Disetujui",
  cancelled: "Dibatalkan",
};
const label = (v: string | null | undefined) =>
  v == null ? "" : (STATUS_LABEL[v] ?? v);

const d = (v: Date | string | null | undefined) =>
  v == null ? null : v instanceof Date ? v : new Date(v);

const num = (v: string | number | null | undefined) =>
  v == null ? 0 : typeof v === "number" ? v : Number(v) || 0;

/** Kolom nomor urut — sama di semua lembar. */
function noCol<T>(): StyledCol<T> {
  return {
    header: "No",
    width: 6,
    fmt: "int",
    total: false,
    formula: (r, ctx) => `ROW()-${ctx.firstRow - 1}`,
  };
}

export async function downloadInvestorWorkbook(): Promise<void> {
  const [inv, peng, share, wd, cred, dist] = await Promise.all([
    listInvestors({ status: "all", pageSize: 1000 }),
    listPengelola(),
    fetchShareTransactions({ limit: 1000 }),
    fetchWithdrawals({ limit: 1000 }),
    fetchCreditors({ status: "all" }),
    listDistributions(),
  ]);

  const investors = investorOk(inv) ? inv.data.items : [];
  const pengelola = pengelolaOk(peng) ? peng.data : [];
  const shares = shareOk(share) ? share.data : [];
  const withdrawals = wdOk(wd) ? wd.data : [];
  const creditors = creditorOk(cred) ? cred.data : [];
  const distributions = distOk(dist) ? dist.data : [];

  const today = new Date().toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const sub = `Mahakan Coffee & Space · diunduh ${today}`;

  const sheets: Array<StyledSheet<never>> = [];

  /* ---------------------------------------------------------- INVESTOR --- */
  if (investors.length > 0) {
    const cols: Array<StyledCol<(typeof investors)[number]>> = [
      noCol(),
      { header: "Nama", value: (r) => r.fullName, width: 28 },
      { header: "Panggilan", value: (r) => r.nickname ?? "" },
      { header: "Modal Disetor", value: (r) => r.modalDisetor, fmt: "money" },
      {
        header: "% Share",
        fmt: "pct",
        total: false,
        /* Rumus hidup: kalau owner mengubah modal, persentasenya ikut. */
        formula: (r, ctx) =>
          `IFERROR(D${r}/SUM($D$${ctx.firstRow}:$D$${ctx.lastRow}),0)`,
      },
      {
        header: "Saldo Dividen",
        value: (r) => r.dividendBalance,
        fmt: "money",
      },
      { header: "Dividen YTD", value: (r) => r.dividendYtd, fmt: "money" },
      {
        header: "Dividen Lifetime",
        value: (r) => r.dividendLifetime,
        fmt: "money",
      },
      { header: "Status", value: (r) => label(r.status) },
      { header: "Pekerjaan", value: (r) => r.occupation ?? "" },
      { header: "Telepon", value: (r) => r.phone ?? "" },
      { header: "Email", value: (r) => r.email ?? "" },
      { header: "NIK", value: (r) => r.nik ?? "" },
      { header: "Bank", value: (r) => r.bankName ?? "" },
      { header: "No. Rekening", value: (r) => r.bankAccountNumber ?? "" },
      {
        header: "Atas Nama",
        value: (r) => r.bankAccountHolderName ?? "",
      },
      { header: "Alamat", value: (r) => r.address ?? "", width: 38 },
      { header: "Catatan", value: (r) => r.notes ?? "", width: 30 },
      { header: "Dibuat", value: (r) => d(r.createdAt), fmt: "date" },
    ];
    sheets.push({
      name: "Investor",
      title: "Daftar Investor",
      subtitle: sub,
      notes: [`${investors.length} investor terdaftar`],
      cols,
      rows: investors,
      totalRow: true,
    } as unknown as StyledSheet<never>);
  }

  /* --------------------------------------------------------- PENGELOLA --- */
  if (pengelola.length > 0) {
    const cols: Array<StyledCol<(typeof pengelola)[number]>> = [
      noCol(),
      { header: "Nama", value: (r) => r.fullName, width: 28 },
      { header: "Panggilan", value: (r) => r.nickname ?? "" },
      { header: "Modal Disetor", value: (r) => r.modalDisetor, fmt: "money" },
      {
        header: "% Pool Share",
        fmt: "pct",
        total: false,
        formula: (r, ctx) =>
          `IFERROR(D${r}/SUM($D$${ctx.firstRow}:$D$${ctx.lastRow}),0)`,
      },
      { header: "Dividen YTD", value: (r) => r.dividendYtd, fmt: "money" },
      {
        header: "Dividen Lifetime",
        value: (r) => r.dividendLifetime,
        fmt: "money",
      },
      { header: "Status", value: (r) => label(r.status) },
      { header: "Telepon", value: (r) => r.phone ?? "" },
      { header: "Email", value: (r) => r.email ?? "" },
      { header: "Bank", value: (r) => r.bankName ?? "" },
      { header: "No. Rekening", value: (r) => r.bankAccountNumber ?? "" },
      { header: "Atas Nama", value: (r) => r.bankAccountHolderName ?? "" },
      { header: "Catatan", value: (r) => r.notes ?? "", width: 30 },
      { header: "Dibuat", value: (r) => d(r.createdAt), fmt: "date" },
    ];
    sheets.push({
      name: "Pengelola",
      title: "Daftar Pengelola",
      subtitle: sub,
      notes: [`${pengelola.length} pengelola terdaftar`],
      cols,
      rows: pengelola,
      totalRow: true,
    } as unknown as StyledSheet<never>);
  }

  /* ------------------------------------------------------ MUTASI SAHAM --- */
  if (shares.length > 0) {
    const cols: Array<StyledCol<(typeof shares)[number]>> = [
      noCol(),
      { header: "Tanggal", value: (r) => d(r.occurredAt), fmt: "date" },
      { header: "Jenis", value: (r) => label(r.kind) },
      { header: "Dari", value: (r) => r.fromInvestorName ?? "", width: 24 },
      { header: "Ke", value: (r) => r.toInvestorName ?? "", width: 24 },
      { header: "Δ % Share", value: (r) => num(r.sharePctDelta) / 100, fmt: "pct", total: false },
      { header: "Nilai", value: (r) => r.amountIdr, fmt: "money" },
      { header: "Rekening", value: (r) => r.bankLabel ?? "" },
      { header: "Status", value: (r) => label(r.status) },
      { header: "Keterangan", value: (r) => r.description ?? "", width: 36 },
      { header: "Dicatat oleh", value: (r) => r.createdByName ?? "" },
    ];
    sheets.push({
      name: "Mutasi Saham",
      title: "Mutasi Saham",
      subtitle: sub,
      cols,
      rows: shares,
      totalRow: true,
    } as unknown as StyledSheet<never>);
  }

  /* ---------------------------------------------------------- PENCAIRAN -- */
  if (withdrawals.length > 0) {
    const cols: Array<StyledCol<(typeof withdrawals)[number]>> = [
      noCol(),
      { header: "Tanggal", value: (r) => d(r.occurredAt), fmt: "date" },
      { header: "Investor", value: (r) => r.investorName, width: 28 },
      { header: "Jumlah", value: (r) => r.amount, fmt: "money" },
      { header: "Rekening", value: (r) => r.bankLabel },
      { header: "Status", value: (r) => label(r.status) },
      { header: "Alasan Batal", value: (r) => r.reversalReason ?? "", width: 30 },
      { header: "Dicatat oleh", value: (r) => r.createdByName ?? "" },
    ];
    sheets.push({
      name: "Pencairan Dividen",
      title: "Pencairan Dividen",
      subtitle: sub,
      cols,
      rows: withdrawals,
      totalRow: true,
    } as unknown as StyledSheet<never>);
  }

  /* ----------------------------------------------------- HUTANG KREDITUR - */
  if (creditors.length > 0) {
    const cols: Array<StyledCol<(typeof creditors)[number]>> = [
      noCol(),
      { header: "Nama", value: (r) => r.fullName, width: 28 },
      { header: "Pokok Awal", value: (r) => r.principalOriginal, fmt: "money" },
      {
        header: "Sudah Dibayar",
        value: (r) => r.totalPaidPrincipal,
        fmt: "money",
      },
      {
        header: "Sisa Pokok",
        fmt: "money",
        /* Selisih dihitung Excel, jadi ikut berubah kalau angkanya diedit. */
        formula: (r) => `C${r}-D${r}`,
      },
      { header: "Bunga Dibayar", value: (r) => r.totalPaidInterest, fmt: "money" },
      {
        header: "Bunga %",
        value: (r) => num(r.interestRatePct) / 100,
        fmt: "pct",
        total: false,
      },
      { header: "Periode Bunga", value: (r) => label(r.interestPeriod) },
      { header: "Status", value: (r) => label(r.status) },
      { header: "Jml Cicilan", value: (r) => r.repaymentCount, fmt: "int" },
      { header: "Telepon", value: (r) => r.phone ?? "" },
      { header: "Bank", value: (r) => r.bankName ?? "" },
      { header: "No. Rekening", value: (r) => r.bankAccountNumber ?? "" },
      { header: "Dibuat", value: (r) => d(r.createdAt), fmt: "date" },
    ];
    sheets.push({
      name: "Hutang Kreditur",
      title: "Hutang Kreditur",
      subtitle: sub,
      cols,
      rows: creditors,
      totalRow: true,
    } as unknown as StyledSheet<never>);
  }

  /* -------------------------------------------------------- DISTRIBUSI --- */
  if (distributions.length > 0) {
    const cols: Array<StyledCol<(typeof distributions)[number]>> = [
      noCol(),
      {
        header: "Periode",
        value: (r) => `${String(r.periodMonth).padStart(2, "0")}/${r.periodYear}`,
        width: 16,
      },
      { header: "Laba Bersih", value: (r) => r.netProfitSnapshot, fmt: "money" },
      { header: "Bagi Hasil", value: (r) => r.bagiHasilAmount, fmt: "money" },
      { header: "Pool Investor", value: (r) => r.investorPoolAmount, fmt: "money" },
      { header: "Pool Pengelola", value: (r) => r.pengelolaPoolAmount, fmt: "money" },
      { header: "Cadangan Rugi", value: (r) => r.lossAmount, fmt: "money" },
      { header: "Cadangan Capex", value: (r) => r.capexAmount, fmt: "money" },
      { header: "Laba Ditahan", value: (r) => r.retainedAmount, fmt: "money" },
      { header: "Status", value: (r) => label(r.status) },
      { header: "Dibuat", value: (r) => d(r.createdAt), fmt: "date" },
    ];
    sheets.push({
      name: "Distribusi",
      title: "Distribusi Laba",
      subtitle: sub,
      cols,
      rows: distributions,
      totalRow: true,
    } as unknown as StyledSheet<never>);
  }

  if (sheets.length === 0) throw new Error("EMPTY");

  const stamp = todayJakarta();
  await downloadStyledXlsx(`modal-dividen-mahakan-${stamp}`, sheets);
}
