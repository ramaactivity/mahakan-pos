/**
 * Sesi AE-222 — ekspor Rekap Pembelanjaan ke CSV.
 *
 * Dua bentuk, karena dua pertanyaan berbeda:
 *  - RINGKASAN: satu baris per kelompok (bulan/bahan/supplier/…), untuk
 *    ditempel ke laporan bulanan.
 *  - RINCIAN: satu baris per baris belanja, untuk diaduk sendiri di Excel.
 *
 * Angka ditulis sebagai NUMBER mentah (bukan "Rp 1.200"), supaya Excel bisa
 * langsung menjumlah tanpa owner harus membersihkan format dulu.
 */
import Papa from "papaparse";
import {
  SPEND_PAYMENT_LABELS,
  SPEND_SECTION_LABELS,
  type SpendGroupRow,
  type SpendLine,
} from "@/features/purchases";

export { downloadCsv } from "../../reports/menu-engineering-csv";

export function buildSpendSummaryCsv(input: {
  dimensionLabel: string;
  rows: SpendGroupRow[];
  total: number;
}): string {
  type Row = Record<string, string | number>;
  const key = input.dimensionLabel;
  const data: Row[] = input.rows.map((r) => ({
    [key]: r.label,
    Keterangan: r.sublabel ?? "",
    Rupiah: r.amount,
    "Porsi %": Math.round(r.share * 1000) / 10,
    Qty: r.qty ?? "",
    Satuan: r.unit ?? "",
    "Harga rata-rata": r.avgUnitCost ?? "",
    "Jumlah nota": r.purchaseCount,
    "Jumlah baris": r.lineCount,
    "Pertama beli": r.firstDate,
    "Terakhir beli": r.lastDate,
  }));
  data.push({
    [key]: "TOTAL",
    Keterangan: "",
    Rupiah: input.total,
    "Porsi %": 100,
    Qty: "",
    Satuan: "",
    "Harga rata-rata": "",
    "Jumlah nota": "",
    "Jumlah baris": "",
    "Pertama beli": "",
    "Terakhir beli": "",
  });
  return Papa.unparse(data);
}

export function buildSpendDetailCsv(lines: SpendLine[]): string {
  return Papa.unparse(
    lines.map((l) => ({
      Tanggal: l.date,
      "Tanggal nota": l.purchaseDate,
      Nota: l.invoiceNo ?? "",
      Supplier: l.supplierName ?? "Tanpa supplier",
      Section: SPEND_SECTION_LABELS[l.section],
      Bahan: l.ingredientName,
      Qty: l.qty,
      Satuan: l.unit,
      Rupiah: l.amount,
      "Metode bayar": SPEND_PAYMENT_LABELS[l.paymentMethod],
      "Status bayar": l.paymentStatus === "paid" ? "Lunas" : "Belum lunas",
      Sumber: l.source === "gr" ? "Terima Barang (GR)" : "Pembelian langsung",
    })),
  );
}

/** Nama berkas yang menjelaskan dirinya sendiri di folder Download. */
export function spendCsvFilename(
  kind: "ringkasan" | "rincian",
  dimension: string,
  from: string,
  to: string,
): string {
  const slug = dimension.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `rekap-belanja-${kind}-${slug}-${from}_${to}.csv`;
}
