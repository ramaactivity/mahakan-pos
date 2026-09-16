"use client";

/**
 * Sesi AE-231 — unduh seluruh data Hutang Internal jadi satu berkas Excel.
 *
 * Tiga lembar: rekap per pihak, rincian hutang masuk, dan riwayat cicilan.
 * Sisa hutang di lembar rekap dibuat sebagai RUMUS, bukan angka mati, supaya
 * berkasnya tetap benar kalau owner menyunting angkanya di Excel.
 */

import {
  downloadStyledXlsx,
  type StyledCol,
  type StyledSheet,
} from "@/lib/xlsx-styled";
import { todayJakarta } from "@/lib/tz";
import {
  fetchInternalDebtParties,
  fetchInternalDebtEntries,
  fetchInternalDebtRepayments,
  isOk,
  PARTY_TYPE_LABELS,
} from "@/features/internal-debts";

const KIND_LABEL: Record<string, string> = {
  expense_advance: "Talangan Biaya",
  cash_loan: "Pinjaman Tunai",
};

const d = (v: Date | string | null | undefined) =>
  v == null ? null : v instanceof Date ? v : new Date(v);

function noCol<T>(): StyledCol<T> {
  return {
    header: "No",
    width: 6,
    fmt: "int",
    total: false,
    formula: (r, ctx) => `ROW()-${ctx.firstRow - 1}`,
  };
}

export async function downloadInternalDebtWorkbook(): Promise<void> {
  const [p, e, rp] = await Promise.all([
    fetchInternalDebtParties({ status: "all" }),
    fetchInternalDebtEntries({ limit: 1000 }),
    fetchInternalDebtRepayments({ limit: 1000 }),
  ]);

  const parties = isOk(p) ? p.data : [];
  const entries = isOk(e) ? e.data : [];
  const repayments = isOk(rp) ? rp.data : [];

  const today = new Date().toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const sub = `Mahakan Coffee & Space · diunduh ${today}`;
  const sheets: Array<StyledSheet<never>> = [];

  /* -------------------------------------------------------- REKAP PIHAK - */
  if (parties.length > 0) {
    const cols: Array<StyledCol<(typeof parties)[number]>> = [
      noCol(),
      { header: "Pihak", value: (r) => r.name, width: 28 },
      {
        header: "Tipe",
        value: (r) => PARTY_TYPE_LABELS[r.partyType] ?? r.partyType,
      },
      { header: "Total Hutang", value: (r) => r.totalDebt, fmt: "money" },
      { header: "Sudah Dicicil", value: (r) => r.totalRepaid, fmt: "money" },
      {
        header: "Sisa Hutang",
        fmt: "money",
        formula: (r) => `D${r}-E${r}`,
      },
      {
        header: "Status",
        value: (r) => (r.totalOutstanding > 0 ? "Belum Lunas" : "Lunas"),
      },
      { header: "Jml Hutang", value: (r) => r.entryCount, fmt: "int" },
      { header: "Jml Cicilan", value: (r) => r.repaymentCount, fmt: "int" },
      { header: "Telepon", value: (r) => r.phone ?? "" },
      { header: "Bank", value: (r) => r.bankName ?? "" },
      { header: "No. Rekening", value: (r) => r.bankAccountNumber ?? "" },
      { header: "Atas Nama", value: (r) => r.bankAccountHolderName ?? "" },
      { header: "Catatan", value: (r) => r.notes ?? "", width: 30 },
    ];
    sheets.push({
      name: "Rekap Pihak",
      title: "Hutang Internal — Rekap per Pihak",
      subtitle: sub,
      notes: [
        "Talangan owner/pengelola: biaya yang dibayar pakai uang pribadi atau pinjaman tunai ke bisnis (tanpa bunga).",
        `${parties.length} pihak tercatat`,
      ],
      cols,
      rows: parties,
      totalRow: true,
    } as unknown as StyledSheet<never>);
  }

  /* ------------------------------------------------------ HUTANG MASUK -- */
  if (entries.length > 0) {
    const cols: Array<StyledCol<(typeof entries)[number]>> = [
      noCol(),
      { header: "Tanggal", value: (r) => d(r.occurredAt), fmt: "date" },
      { header: "Pihak", value: (r) => r.partyName, width: 26 },
      { header: "Jenis", value: (r) => KIND_LABEL[r.kind] ?? r.kind, width: 18 },
      { header: "Jumlah", value: (r) => r.amount, fmt: "money" },
      { header: "Keterangan", value: (r) => r.description, width: 40 },
      { header: "Kategori", value: (r) => r.categoryName ?? "" },
      { header: "Rekening", value: (r) => r.bankLabel ?? "" },
      { header: "Dicatat oleh", value: (r) => r.createdByName ?? "" },
    ];
    sheets.push({
      name: "Hutang Masuk",
      title: "Hutang Internal — Rincian Hutang Masuk",
      subtitle: sub,
      cols,
      rows: entries,
      totalRow: true,
    } as unknown as StyledSheet<never>);
  }

  /* ----------------------------------------------------------- CICILAN -- */
  if (repayments.length > 0) {
    const cols: Array<StyledCol<(typeof repayments)[number]>> = [
      noCol(),
      { header: "Tanggal", value: (r) => d(r.occurredAt), fmt: "date" },
      { header: "Pihak", value: (r) => r.partyName, width: 26 },
      { header: "Jumlah", value: (r) => r.amount, fmt: "money" },
      { header: "Rekening", value: (r) => r.bankLabel, width: 24 },
      { header: "Keterangan", value: (r) => r.description ?? "", width: 40 },
      { header: "Dicatat oleh", value: (r) => r.createdByName ?? "" },
    ];
    sheets.push({
      name: "Cicilan",
      title: "Hutang Internal — Riwayat Cicilan",
      subtitle: sub,
      cols,
      rows: repayments,
      totalRow: true,
    } as unknown as StyledSheet<never>);
  }

  if (sheets.length === 0) throw new Error("EMPTY");

  const stamp = todayJakarta();
  await downloadStyledXlsx(`hutang-internal-mahakan-${stamp}`, sheets);
}
