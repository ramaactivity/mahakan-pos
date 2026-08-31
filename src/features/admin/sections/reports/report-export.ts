/**
 * Sesi AE-224 — ekspor bersama untuk SEMUA tab Laporan.
 *
 * Kenapa Excel, bukan CSV saja: CSV yang dipakai selama ini ditulis tanpa BOM
 * dan dipisah koma. Excel berbahasa Indonesia membaca koma sebagai pemisah
 * DESIMAL, jadi file itu mendarat menumpuk di satu kolom dan huruf beraksen
 * jadi kacau. Owner minta "download excel/csv" justru karena itu. File .xlsx
 * tidak punya masalah pemisah maupun encoding sama sekali, dan angkanya
 * tersimpan sebagai ANGKA — bisa langsung dijumlah di Excel, tidak perlu
 * dibersihkan dulu dari "Rp" dan titik ribuan.
 *
 * Aturan isi: kolom rupiah diisi angka mentah (1234567), bukan teks
 * terformat. Yang butuh rapi cukup diatur lebar kolomnya di sini.
 */
import * as XLSX from "xlsx";

/** Satu baris = satu objek; kunci objek jadi judul kolom. */
export type ExportRow = Record<string, string | number | null | undefined>;

export interface ExportSheet {
  /** Nama tab di dalam file Excel. Maks 31 karakter (batas Excel). */
  name: string;
  rows: ExportRow[];
}

function sanitizeSheetName(name: string): string {
  /* Excel menolak : \ / ? * [ ] dan nama di atas 31 karakter. */
  return name.replace(/[:\\/?*[\]]/g, "-").slice(0, 31) || "Sheet1";
}

function autoWidths(rows: ExportRow[]): Array<{ wch: number }> {
  if (rows.length === 0) return [];
  const keys = Object.keys(rows[0]!);
  return keys.map((k) => {
    const longest = rows.reduce((max, r) => {
      const v = r[k];
      const len = v == null ? 0 : String(v).length;
      return len > max ? len : max;
    }, k.length);
    /* Dibatasi supaya kolom catatan yang panjang tidak melebar ekstrem. */
    return { wch: Math.min(Math.max(longest + 2, 10), 45) };
  });
}

/**
 * Unduh satu atau beberapa lembar sebagai file .xlsx.
 * `filenameBase` tanpa ekstensi — ekstensinya ditambahkan di sini.
 */
export function downloadXlsx(
  filenameBase: string,
  sheets: ExportSheet[],
): void {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const sheet of sheets) {
    const ws = XLSX.utils.json_to_sheet(sheet.rows);
    ws["!cols"] = autoWidths(sheet.rows);
    /* Nama lembar wajib unik — kalau bentrok, beri akhiran angka. */
    let name = sanitizeSheetName(sheet.name);
    let n = 2;
    while (used.has(name)) {
      name = sanitizeSheetName(`${sheet.name} ${n}`);
      n += 1;
    }
    used.add(name);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, `${filenameBase}.xlsx`);
}

/**
 * Unduh sebagai CSV yang RAMAH EXCEL: diawali BOM UTF-8 dan dipisah titik
 * koma, sesuai kebiasaan Excel berbahasa Indonesia. Dibiarkan tersedia untuk
 * yang mengolahnya di Google Sheets atau alat lain.
 */
export function downloadCsvForExcel(
  filenameBase: string,
  rows: ExportRow[],
): void {
  if (rows.length === 0) return;
  const keys = Object.keys(rows[0]!);
  const escape = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    keys.join(";"),
    ...rows.map((r) => keys.map((k) => escape(r[k])).join(";")),
  ];
  const content = `﻿${lines.join("\r\n")}`;
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenameBase}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
