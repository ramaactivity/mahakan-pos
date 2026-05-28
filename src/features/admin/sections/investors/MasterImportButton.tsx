"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react";
import {
  Button,
  Modal,
  Select,
  toast,
} from "@/components/ui";
import { bulkImportInvestors, isOk as investorsIsOk } from "@/features/investors";
import { bulkImportPengelola, isOk as pengelolaIsOk } from "@/features/pengelola";
import { bulkImportCreditors, isOk as creditorsIsOk } from "@/features/creditors";
import {
  downloadMasterTemplate,
  parseMasterTemplate,
  type ParseMasterResult,
} from "./master-xlsx";

/**
 * Sesi AE-160g — Tombol unified untuk download template Excel multi-sheet +
 * upload + auto-route ke 3 bulkImport action existing (Investor, Pengelola,
 * Kreditur).
 *
 * Workflow owner:
 *   1. Klik "Download Template" → dapat .xlsx dengan 4 sheet (PETUNJUK +
 *      INVESTOR + PENGELOLA + KREDITUR) + contoh data.
 *   2. Edit di Excel/Google Sheets.
 *   3. Klik "Import Excel" → upload .xlsx → preview row count per sheet →
 *      pilih mode (insert_only / upsert) → konfirmasi → server import per
 *      sheet → toast hasil per sheet.
 *
 * Existing wizard CSV per-entity tetap ada untuk power user yang familiar
 * dengan flow lama atau yang mau upload partial.
 */
export function MasterImportButton() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [parseResult, setParseResult] = useState<ParseMasterResult | null>(
    null,
  );
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [mode, setMode] = useState<"insert_only" | "upsert">("insert_only");
  const [results, setResults] = useState<
    Array<{ kind: string; inserted: number; updated: number; skipped: number; errors: number }>
  >([]);

  function reset() {
    setParseResult(null);
    setImporting(false);
    setParsing(false);
    setResults([]);
    setMode("insert_only");
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    setParsing(true);
    setResults([]);
    try {
      const buf = await file.arrayBuffer();
      const res = parseMasterTemplate(buf);
      setParseResult(res);
    } catch (e) {
      toast.error(
        e instanceof Error
          ? `Gagal baca file: ${e.message}`
          : "Gagal baca file Excel",
      );
    } finally {
      setParsing(false);
    }
  }

  async function handleImport() {
    if (!parseResult || importing) return;
    setImporting(true);
    const out: typeof results = [];

    /* INVESTOR */
    if (parseResult.investors.length > 0) {
      const r = await bulkImportInvestors({
        rows: parseResult.investors,
        mode,
      });
      if (investorsIsOk(r)) {
        out.push({
          kind: "Investor",
          inserted: r.data.inserted,
          updated: r.data.updated ?? 0,
          skipped: r.data.skippedDuplicate,
          errors: r.data.errors.length,
        });
      } else {
        out.push({
          kind: "Investor",
          inserted: 0,
          updated: 0,
          skipped: 0,
          errors: parseResult.investors.length,
        });
        toast.error(`Investor: ${r.error.message}`);
      }
    }

    /* PENGELOLA */
    if (parseResult.pengelola.length > 0) {
      const r = await bulkImportPengelola({
        rows: parseResult.pengelola,
        mode,
      });
      if (pengelolaIsOk(r)) {
        out.push({
          kind: "Pengelola",
          inserted: r.data.inserted,
          updated: r.data.updated ?? 0,
          skipped: r.data.skippedDuplicate,
          errors: r.data.errors.length,
        });
      } else {
        out.push({
          kind: "Pengelola",
          inserted: 0,
          updated: 0,
          skipped: 0,
          errors: parseResult.pengelola.length,
        });
        toast.error(`Pengelola: ${r.error.message}`);
      }
    }

    /* KREDITUR */
    if (parseResult.creditors.length > 0) {
      const r = await bulkImportCreditors({
        rows: parseResult.creditors,
        mode,
      });
      if (creditorsIsOk(r)) {
        out.push({
          kind: "Kreditur",
          inserted: r.data.inserted,
          updated: r.data.updated ?? 0,
          skipped: r.data.skippedDuplicate,
          errors: r.data.errors.length,
        });
      } else {
        out.push({
          kind: "Kreditur",
          inserted: 0,
          updated: 0,
          skipped: 0,
          errors: parseResult.creditors.length,
        });
        toast.error(`Kreditur: ${r.error.message}`);
      }
    }

    setResults(out);
    setImporting(false);

    /* Invalidate semua. */
    queryClient.invalidateQueries({ queryKey: ["admin", "investors"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "pengelola"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "creditors"] });

    const totalInserted = out.reduce((a, b) => a + b.inserted, 0);
    const totalUpdated = out.reduce((a, b) => a + b.updated, 0);
    toast.success(
      `Import selesai: ${totalInserted} baru, ${totalUpdated} update`,
    );
  }

  const totalRows =
    (parseResult?.investors.length ?? 0) +
    (parseResult?.pengelola.length ?? 0) +
    (parseResult?.creditors.length ?? 0);

  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => downloadMasterTemplate()}
      >
        <Download className="size-4" />
        Template Excel
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <FileSpreadsheet className="size-4" />
        Import Excel
      </Button>

      <Modal
        open={open}
        onClose={importing ? () => undefined : () => setOpen(false)}
        title="Import Modal & Dividen dari Excel"
        description="Upload file .xlsx yang generated dari template. Sheet INVESTOR + PENGELOLA + KREDITUR akan otomatis di-import. Preview muncul dulu sebelum data masuk."
        size="lg"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={importing}
            >
              Tutup
            </Button>
            {parseResult && results.length === 0 ? (
              <Button
                onClick={handleImport}
                loading={importing}
                disabled={importing || totalRows === 0}
              >
                <Upload className="size-4" />
                Import {totalRows} baris
              </Button>
            ) : null}
          </>
        }
      >
        <div className="space-y-4 text-sm">
          {parsing ? (
            <div className="flex items-center gap-2 text-neutral-600">
              <Loader2 className="size-4 animate-spin" /> Parsing file…
            </div>
          ) : !parseResult ? (
            <div>
              <label className="block text-xs font-medium text-neutral-700">
                Pilih file .xlsx
              </label>
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-mahakan-green-700 file:px-3 file:py-1.5 file:text-white file:hover:bg-mahakan-green-800"
              />
              <p className="mt-2 rounded-md bg-info-50 px-3 py-2 text-[11px] text-info-700">
                Belum punya template? Klik tombol{" "}
                <strong>Template Excel</strong> di header dulu untuk download
                template kosong.
              </p>
            </div>
          ) : results.length === 0 ? (
            <>
              <div className="rounded-md border border-neutral-200 bg-white p-3">
                <p className="mb-2 font-medium text-neutral-900">
                  Preview ({totalRows} baris valid)
                </p>
                <ul className="space-y-1 text-xs">
                  <li className="flex justify-between">
                    <span>Investor</span>
                    <span className="font-mono font-semibold">
                      {parseResult.investors.length}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span>Pengelola</span>
                    <span className="font-mono font-semibold">
                      {parseResult.pengelola.length}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span>Kreditur</span>
                    <span className="font-mono font-semibold">
                      {parseResult.creditors.length}
                    </span>
                  </li>
                </ul>
              </div>

              <Select
                label="Mode import"
                options={[
                  {
                    value: "insert_only",
                    label: "Insert only — skip yang sudah ada",
                  },
                  {
                    value: "upsert",
                    label: "Upsert — update kalau nama/NIK match",
                  },
                ]}
                value={mode}
                onValueChange={(v) =>
                  setMode(v as "insert_only" | "upsert")
                }
              />

              {parseResult.warnings.length > 0 ? (
                <div className="rounded-md border border-warning-300 bg-warning-50 p-3 text-xs text-warning-800">
                  <p className="font-semibold">Peringatan:</p>
                  <ul className="ml-4 list-disc">
                    {parseResult.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {totalRows === 0 ? (
                <p className="rounded-md bg-danger-50 px-3 py-2 text-xs text-danger-700">
                  Tidak ada baris valid yang ditemukan. Cek file: header
                  benar? Nama Lengkap + nominal (Modal/Investasi/Pokok)
                  diisi?
                </p>
              ) : null}
            </>
          ) : (
            <div className="space-y-3">
              <p className="font-medium text-mahakan-green-800">
                Import selesai. Ringkasan:
              </p>
              <div className="overflow-x-auto rounded-md border border-neutral-200">
                <table className="w-full text-xs">
                  <thead className="bg-neutral-50 text-[10px] uppercase text-neutral-500">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Sheet</th>
                      <th className="px-2 py-1.5 text-right">Baru</th>
                      <th className="px-2 py-1.5 text-right">Update</th>
                      <th className="px-2 py-1.5 text-right">Skip</th>
                      <th className="px-2 py-1.5 text-right">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.kind} className="border-t border-neutral-100">
                        <td className="px-2 py-1.5 font-medium">{r.kind}</td>
                        <td className="px-2 py-1.5 text-right font-mono font-semibold text-success-700">
                          {r.inserted}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-warning-700">
                          {r.updated}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-neutral-500">
                          {r.skipped}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-danger-700">
                          {r.errors}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-neutral-500">
                Tab Investor / Pengelola / Kreditur akan refresh otomatis.
              </p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
