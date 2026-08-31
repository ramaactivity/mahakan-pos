"use client";

import { FileSpreadsheet, FileText } from "lucide-react";
import { Button, toast } from "@/components/ui";
import {
  downloadCsvForExcel,
  downloadXlsx,
  type ExportRow,
  type ExportSheet,
} from "./report-export";

interface Props {
  /** Nama file tanpa ekstensi, mis. "closing-shift-2026-08-01-sd-2026-08-31". */
  filenameBase: string;
  /**
   * Penyusun baris. Dipanggil SAAT diklik, bukan saat render — laporan besar
   * tidak perlu menyusun ribuan baris ekspor setiap kali layar bergerak.
   */
  buildSheets: () => ExportSheet[];
  /** Kosong = tombol mati (laporannya belum ada isinya). */
  disabled?: boolean;
  size?: "sm" | "md";
}

/**
 * Sesi AE-224 — sepasang tombol unduh yang sama di seluruh tab Laporan.
 *
 * Excel didahulukan karena itu yang dipakai owner; CSV tetap ada untuk yang
 * mengolahnya di Google Sheets. Keduanya memakai penyusun baris yang sama,
 * jadi isinya tidak akan pernah beda antar format.
 */
export function ReportExportButtons({
  filenameBase,
  buildSheets,
  disabled,
  size = "sm",
}: Props) {
  function run(kind: "xlsx" | "csv") {
    let sheets: ExportSheet[];
    try {
      sheets = buildSheets();
    } catch {
      toast.error("Gagal menyiapkan data ekspor");
      return;
    }
    const total = sheets.reduce((s, sh) => s + sh.rows.length, 0);
    if (total === 0) {
      toast.error("Belum ada data untuk diunduh");
      return;
    }
    if (kind === "xlsx") {
      downloadXlsx(filenameBase, sheets);
      toast.success(`${filenameBase}.xlsx diunduh`);
      return;
    }
    /* CSV hanya bisa satu lembar — gabungkan kalau laporannya berlembar. */
    const flat: ExportRow[] =
      sheets.length === 1
        ? sheets[0]!.rows
        : sheets.flatMap((sh) => sh.rows.map((r) => ({ Bagian: sh.name, ...r })));
    downloadCsvForExcel(filenameBase, flat);
    toast.success(`${filenameBase}.csv diunduh`);
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size={size}
        onClick={() => run("xlsx")}
        disabled={disabled}
        title="Unduh sebagai file Excel (.xlsx) — angka sudah berupa angka, siap dijumlah"
      >
        <FileSpreadsheet className="size-4" /> Excel
      </Button>
      <Button
        variant="outline"
        size={size}
        onClick={() => run("csv")}
        disabled={disabled}
        title="Unduh sebagai CSV (pemisah titik koma, ramah Excel Indonesia)"
      >
        <FileText className="size-4" /> CSV
      </Button>
    </div>
  );
}
