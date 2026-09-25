/**
 * Sesi AE-231 — penulis Excel BERTATA RIAS.
 *
 * `report-export.ts` (AE-224) tetap dipakai tab Laporan: cepat, seadanya,
 * cukup untuk data mentah. Yang ini untuk berkas yang dibaca dan diedit
 * manusia — owner minta judul, kolom rapi, dan rumus yang benar-benar hidup.
 *
 * Kenapa exceljs, bukan `xlsx` yang sudah ada: `xlsx` edisi komunitas TIDAK
 * bisa menulis gaya sel (tebal, ukuran huruf, warna) — itu fitur berbayar.
 * Lebar kolom dan rumus bisa, huruf tidak. Permintaan owner menyebut ukuran
 * huruf secara eksplisit, jadi tidak ada jalan lain.
 *
 * Dimuat malas di dalam pengunduh: ~900KB tidak boleh ikut bundel awal
 * halaman yang bahkan tidak punya tombol unduh.
 */

export type ColFormat = "text" | "money" | "int" | "pct" | "date";

export interface StyledCol<T> {
  header: string;
  /** Pengambil nilai baris. Kembalikan null untuk sel kosong.
   * Boleh dikosongkan kalau kolomnya memakai `formula`. */
  value?: (row: T) => string | number | Date | null;
  /** Lebar kolom Excel. Default menyesuaikan isi. */
  width?: number;
  fmt?: ColFormat;
  /**
   * Rumus hidup untuk KOLOM ini, dievaluasi per baris data.
   * `r` = nomor baris Excel sebenarnya. Kalau diisi, `value` diabaikan.
   */
  formula?: (r: number, ctx: SheetCtx) => string;
  /** Sertakan kolom ini di baris TOTAL (SUM). Default: true untuk money/int. */
  total?: boolean;
  /** Teks panjang turun ke baris berikutnya; tinggi baris ikut menyesuaikan. */
  wrap?: boolean;
}

/** Sesi AE-234 — warna latar satu baris penuh untuk menandai baris penting. */
export type RowTone = "danger" | "warning" | null;

export interface SheetCtx {
  /** Baris Excel pertama yang berisi data. */
  firstRow: number;
  /** Baris Excel terakhir yang berisi data. */
  lastRow: number;
}

export interface StyledSheet<T = Record<string, unknown>> {
  name: string;
  title: string;
  subtitle?: string;
  cols: Array<StyledCol<T>>;
  rows: T[];
  /** Tambahkan baris TOTAL ber-SUM di bawah data. */
  totalRow?: boolean;
  /** Baris ringkasan "label: nilai" di atas tabel (mis. total modal). */
  notes?: string[];
  /** Tandai baris tertentu (mis. bill yang totalnya turun) dengan warna. */
  rowTone?: (row: T) => RowTone;
}

const NUM_FMT: Record<ColFormat, string> = {
  text: "@",
  money: '#,##0;[Red]-#,##0',
  int: "#,##0",
  pct: "0.00%",
  date: "dd/mm/yyyy",
};

const GREEN = "FF1F5138";
const GREEN_SOFT = "FFEAF1ED";
const TONE_FILL: Record<"danger" | "warning", string> = {
  danger: "FFFDE7E4",
  warning: "FFFEF3DC",
};
const TONE_FONT: Record<"danger" | "warning", string> = {
  danger: "FF9F1C12",
  warning: "FF7A4A00",
};

/** Perkiraan jumlah baris teks sebuah sel ber-wrap (Excel tidak autofit saat buka). */
function wrappedLines(v: unknown, width: number): number {
  if (v == null) return 1;
  return String(v)
    .split("\n")
    .reduce((n, part) => n + Math.max(1, Math.ceil(part.length / Math.max(width - 2, 1))), 0);
}

function autoWidth<T>(col: StyledCol<T>, rows: T[]): number {
  if (col.width) return col.width;
  const longest = rows.reduce((max, r) => {
    const v = col.formula ? "" : (col.value?.(r) ?? "");
    const len = v == null ? 0 : String(v).length;
    return len > max ? len : max;
  }, col.header.length);
  return Math.min(Math.max(longest + 3, 12), 42);
}

/**
 * Susun workbook-nya saja. Dipisah dari pengunduh supaya bisa diuji di node
 * (pengunduhnya butuh Blob + anchor yang hanya ada di peramban).
 */
export async function buildStyledWorkbook(
  sheets: Array<StyledSheet<never>>,
) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Mahakan POS";
  wb.created = new Date();

  for (const sheet of sheets) {
    const rows = sheet.rows as unknown[];
    const cols = sheet.cols as Array<StyledCol<unknown>>;
    const ws = wb.addWorksheet(sheet.name.replace(/[:\\/?*[\]]/g, "-").slice(0, 31));
    ws.properties.defaultRowHeight = 18;
    const widths = cols.map((c) => autoWidth(c, rows));
    ws.columns = widths.map((width) => ({ width }));

    /* ---- kepala berkas ---- */
    const lastCol = cols.length;
    const titleRow = ws.addRow([sheet.title]);
    ws.mergeCells(titleRow.number, 1, titleRow.number, lastCol);
    titleRow.getCell(1).font = { bold: true, size: 15, color: { argb: GREEN } };
    titleRow.height = 26;

    if (sheet.subtitle) {
      const sub = ws.addRow([sheet.subtitle]);
      ws.mergeCells(sub.number, 1, sub.number, lastCol);
      sub.getCell(1).font = { size: 10, italic: true, color: { argb: "FF6B7280" } };
    }
    for (const note of sheet.notes ?? []) {
      const n = ws.addRow([note]);
      ws.mergeCells(n.number, 1, n.number, lastCol);
      n.getCell(1).font = { size: 10, color: { argb: "FF374151" } };
    }
    ws.addRow([]);

    /* ---- kepala tabel ---- */
    const header = ws.addRow(cols.map((c) => c.header));
    header.height = 22;
    header.eachCell((cell, i) => {
      if (i > lastCol) return;
      cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = { bottom: { style: "thin", color: { argb: GREEN } } };
    });

    /* ---- isi ---- */
    const firstRow = header.number + 1;
    const lastRow = firstRow + rows.length - 1;
    const ctx: SheetCtx = { firstRow, lastRow };

    const rowTone = sheet.rowTone as ((row: unknown) => RowTone) | undefined;
    rows.forEach((row, idx) => {
      const values = cols.map((c) => (c.formula ? null : (c.value?.(row) ?? null)));
      const r = ws.addRow(values);
      const lines = cols.reduce(
        (max, c, i) => (c.wrap ? Math.max(max, wrappedLines(values[i], widths[i]!)) : max),
        1,
      );
      r.height = Math.max(17, lines * 14 + 4);
      const tone = rowTone?.(row) ?? null;
      cols.forEach((c, i) => {
        const cell = r.getCell(i + 1);
        if (c.formula) cell.value = { formula: c.formula(r.number, ctx) };
        cell.numFmt = NUM_FMT[c.fmt ?? "text"];
        cell.font = tone ? { size: 11, color: { argb: TONE_FONT[tone] } } : { size: 11 };
        cell.alignment = {
          vertical: lines > 1 ? "top" : "middle",
          wrapText: c.wrap ?? false,
          horizontal:
            c.fmt === "money" || c.fmt === "int" || c.fmt === "pct"
              ? "right"
              : c.fmt === "date"
                ? "center"
                : "left",
        };
        if (tone) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TONE_FILL[tone] } };
        } else if (idx % 2 === 1) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: GREEN_SOFT },
          };
        }
        cell.border = { bottom: { style: "hair", color: { argb: "FFD9DDD8" } } };
      });
    });

    /* ---- baris TOTAL: rumus SUM sungguhan, bukan angka mati ---- */
    if (sheet.totalRow && rows.length > 0) {
      const t = ws.addRow([]);
      t.height = 20;
      cols.forEach((c, i) => {
        const cell = t.getCell(i + 1);
        const isSum = c.total ?? (c.fmt === "money" || c.fmt === "int");
        if (i === 0) cell.value = "TOTAL";
        else if (isSum) {
          const L = cell.address.replace(/\d+/g, "");
          cell.value = { formula: `SUM(${L}${firstRow}:${L}${lastRow})` };
        }
        cell.numFmt = i === 0 ? "@" : NUM_FMT[c.fmt ?? "text"];
        cell.font = { bold: true, size: 11, color: { argb: GREEN } };
        cell.alignment = {
          vertical: "middle",
          horizontal: i === 0 ? "left" : "right",
        };
        cell.border = { top: { style: "double", color: { argb: GREEN } } };
      });
    }

    /* Kepala tabel tetap terlihat saat digulir + saringan per kolom. */
    ws.views = [{ state: "frozen", ySplit: header.number }];
    if (rows.length > 0) {
      ws.autoFilter = {
        from: { row: header.number, column: 1 },
        to: { row: lastRow, column: lastCol },
      };
    }
  }

  return wb;
}

/**
 * Tulis beberapa lembar bergaya jadi satu berkas .xlsx lalu unduh.
 * Hanya jalan di peramban.
 */
export async function downloadStyledXlsx(
  filenameBase: string,
  sheets: Array<StyledSheet<never>>,
): Promise<void> {
  const wb = await buildStyledWorkbook(sheets);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenameBase}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
