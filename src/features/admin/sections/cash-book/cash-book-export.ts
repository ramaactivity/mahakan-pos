import type { CashBook, CashBookLine } from "@/features/accounting/cash-book-pure";
import type { StyledCol, StyledSheet } from "@/lib/xlsx-styled";

/* Sesi AE-239 — unduhan Buku Kas. Bentuknya mengikuti sheet "BUKU KAS" yang
 * dulu diisi owner: Tanggal · Ref · No. Akun · Uraian · Penerimaan (D) ·
 * Pengeluaran (K) · Saldo · Keterangan, diawali baris Saldo Awal. Kolom
 * Saldo berupa RUMUS hidup (saldo baris atas + D − K), jadi kalau owner
 * menambah baris di Excel, saldonya ikut berjalan. Selalu SELURUH buku
 * periode itu — saringan layar tidak ikut, karena rumus saldo butuh baris
 * yang utuh. */

type Row = { opening: true; amount: number } | (CashBookLine & { opening?: false });

const dmy = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const toDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
};
const accountCodes = (l: CashBookLine) =>
  l.counterparts.map((c) => c.code).join(", ") || (l.isTransfer ? "antar kas" : "");
const colLetter = (i: number) => String.fromCharCode(65 + i);

export function cashBookTitle(book: CashBook): string {
  const acc = book.accounts.find((a) => a.id === book.accountId);
  return acc ? `${acc.code} ${acc.name}` : "Semua Kas & Bank";
}

export function buildCashBookSheet(book: CashBook): StyledSheet<Row> {
  const all = book.accountId === null;
  const rows: Row[] = [{ opening: true, amount: book.openingBalance }, ...book.lines];

  const cols: Array<StyledCol<Row>> = [
    { header: "Tanggal", value: (r) => (r.opening ? toDate(book.from) : toDate(r.entryDate)), fmt: "date", width: 12 },
    { header: "Ref", value: (r) => (r.opening ? null : r.entryNumber), width: 16 },
    { header: "No. Akun", value: (r) => (r.opening ? null : accountCodes(r)), width: 19, wrap: true },
    { header: "Uraian", value: (r) => (r.opening ? "Saldo Awal" : r.description), width: 46, wrap: true },
  ];
  if (all) {
    cols.push({ header: "Kas / Bank", value: (r) => (r.opening ? null : r.cashAccount), width: 22, wrap: true });
  }
  const dIdx = cols.length;
  cols.push(
    { header: "Penerimaan (D)", value: (r) => (r.opening || !r.masuk ? null : r.masuk), fmt: "money", width: 16 },
    { header: "Pengeluaran (K)", value: (r) => (r.opening || !r.keluar ? null : r.keluar), fmt: "money", width: 16 },
  );
  const [D, K, S] = [colLetter(dIdx), colLetter(dIdx + 1), colLetter(dIdx + 2)];
  cols.push(
    {
      header: "Saldo",
      value: (r) => (r.opening ? r.amount : r.saldo),
      fmt: "money",
      width: 17,
      total: false,
      formula: (r, ctx) => (r === ctx.firstRow ? `${book.openingBalance}` : `${S}${r - 1}+${D}${r}-${K}${r}`),
    },
    { header: "Keterangan", value: (r) => (r.opening ? null : r.source), width: 24, wrap: true },
  );

  const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
  return {
    name: "Buku Kas",
    title: "MAHAKAN CAFÉ — BUKU KAS",
    subtitle: `${cashBookTitle(book)} · periode ${dmy(book.from)} s/d ${dmy(book.to)}`,
    notes: [
      `Saldo awal ${rp(book.openingBalance)} · Uang masuk ${rp(book.totalIn)} · Uang keluar ${rp(book.totalOut)} · Saldo akhir ${rp(book.closingBalance)}`,
      "Terisi otomatis dari jurnal Mahakan POS (kasir, pembelian, gaji, setoran, input Kas). Kolom Saldo = saldo baris atas + Penerimaan − Pengeluaran.",
    ],
    cols,
    rows,
    totalRow: true,
    rowTone: (r) => (!r.opening && r.saldo < 0 ? "danger" : null),
  };
}

export function cashBookCsvRows(book: CashBook) {
  const all = book.accountId === null;
  const opening = {
    Tanggal: dmy(book.from),
    Ref: "",
    "No. Akun": "",
    Uraian: "Saldo Awal",
    ...(all ? { "Kas / Bank": "" } : {}),
    "Penerimaan (D)": "",
    "Pengeluaran (K)": "",
    Saldo: book.openingBalance,
    Keterangan: "",
  };
  return [
    opening,
    ...book.lines.map((l) => ({
      Tanggal: dmy(l.entryDate),
      Ref: l.entryNumber,
      "No. Akun": accountCodes(l),
      Uraian: l.description,
      ...(all ? { "Kas / Bank": l.cashAccount } : {}),
      "Penerimaan (D)": l.masuk || "",
      "Pengeluaran (K)": l.keluar || "",
      Saldo: l.saldo,
      Keterangan: l.source,
    })),
  ];
}
