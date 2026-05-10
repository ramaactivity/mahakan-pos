"use client";

import { useState } from "react";
import { CheckCircle2, Upload, XCircle } from "lucide-react";
import { Button, Modal, toast } from "@/components/ui";
import {
  bulkImportMarketList,
  deleteAllMarketItems,
  isOk,
  type BulkImportResult,
} from "@/features/market-list";
import { parseIndonesianInt, parseIndonesianNumber } from "@/lib/format";

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

interface ParsedRow {
  supplierName: string;
  ingredientName: string;
  unitCost: number;
  packSize: number;
  packUnit: string;
  isPrimary?: boolean;
  notes?: string | null;
}

interface ParseResult {
  rows: ParsedRow[];
  warnings: string[];
}

/** CSV format expected (header required, comma OR semicolon separator):
 *
 *   supplier,bahan,harga,pack_size,pack_unit,primary,notes
 *   "Pasar Cisarua","Bawang Bombay",36000,1000,gr,yes,
 *   "Toko Indah","Beras",12000,1,Kg,no,promo
 *
 * - `primary` accepts: yes/y/true/1 → true; else false
 * - `notes` optional
 */
function parseCsv(text: string): ParseResult {
  const warnings: string[] = [];
  const rows: ParsedRow[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { rows, warnings: ["File kosong"] };
  }
  const sep = lines[0]!.includes(";") ? ";" : ",";
  const header = splitCsvLine(lines[0]!, sep).map((h) =>
    h.toLowerCase().trim(),
  );
  const idx = {
    supplier: header.indexOf("supplier"),
    bahan: header.findIndex((h) => h === "bahan" || h === "ingredient"),
    harga: header.findIndex(
      (h) => h === "harga" || h === "price" || h === "unit_cost",
    ),
    packSize: header.findIndex(
      (h) => h === "pack_size" || h === "pack" || h === "qty",
    ),
    packUnit: header.findIndex(
      (h) => h === "pack_unit" || h === "unit" || h === "satuan",
    ),
    primary: header.findIndex((h) => h === "primary" || h === "is_primary"),
    notes: header.indexOf("notes"),
  };
  if (
    idx.supplier === -1 ||
    idx.bahan === -1 ||
    idx.harga === -1 ||
    idx.packSize === -1 ||
    idx.packUnit === -1
  ) {
    return {
      rows,
      warnings: [
        "Header CSV harus berisi minimal: supplier, bahan, harga, pack_size, pack_unit",
      ],
    };
  }
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const cells = splitCsvLine(line, sep);
    const supplierName = cells[idx.supplier]?.trim() ?? "";
    const ingredientName = cells[idx.bahan]?.trim() ?? "";
    const hargaCell = cells[idx.harga] ?? "";
    const sizeCell = cells[idx.packSize] ?? "";
    const packUnit = cells[idx.packUnit]?.trim() ?? "";
    const isPrimaryStr =
      idx.primary !== -1 ? (cells[idx.primary] ?? "").trim().toLowerCase() : "";
    const notes =
      idx.notes !== -1 ? (cells[idx.notes] ?? "").trim() || null : null;
    if (!supplierName || !ingredientName) {
      warnings.push(`Baris ${i + 1}: supplier / bahan kosong, skip`);
      continue;
    }
    // Sesi AE-30 — parse number Indonesian-aware. Owner CSV pakai titik
    // sebagai thousand separator ("Rp 36.000" = 36000, "1.000" = 1000).
    // Sebelumnya parseInt("36.000") = 36 (stop di titik) → harga + pack
    // size salah parse ke nilai mini → effective cost 1000x off.
    const unitCost = parseIndonesianInt(hargaCell);
    const packSize = parseIndonesianNumber(sizeCell);
    if (!Number.isFinite(unitCost) || unitCost <= 0) {
      warnings.push(`Baris ${i + 1}: harga invalid (${hargaCell}), skip`);
      continue;
    }
    if (!Number.isFinite(packSize) || packSize <= 0) {
      warnings.push(`Baris ${i + 1}: pack_size invalid (${sizeCell}), skip`);
      continue;
    }
    rows.push({
      supplierName,
      ingredientName,
      unitCost,
      packSize,
      packUnit,
      isPrimary: ["yes", "y", "true", "1", "primary"].includes(isPrimaryStr),
      notes,
    });
  }
  return { rows, warnings };
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (c === sep && !inQuote) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

export function MarketCsvImportModal({ open, onClose, onImported }: Props) {
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fileName, setFileName] = useState<string>("");
  /** Sesi AE-27 — kalau true, server auto-create supplier/bahan yang
   *  belum ada di master. Default ON karena ini path utama yang diminta
   *  owner ("kenapa import gagal padahal CSV bener" — biasanya supplier
   *  belum di-create di master). */
  const [createMissing, setCreateMissing] = useState(true);
  /** Sesi AE-31 — kalau true, hapus SEMUA market list existing dulu
   *  sebelum import. Use case: re-import CSV bersih setelah parsing
   *  bug atau revisi data besar. Default OFF karena destructive. */
  const [replaceAll, setReplaceAll] = useState(false);
  const [importResult, setImportResult] = useState<BulkImportResult | null>(
    null,
  );

  function reset() {
    setParsed(null);
    setSubmitting(false);
    setFileName("");
    setImportResult(null);
  }

  async function handleFile(file: File) {
    setFileName(file.name);
    setImportResult(null);
    const text = await file.text();
    setParsed(parseCsv(text));
  }

  async function handleImport() {
    if (!parsed || parsed.rows.length === 0 || submitting) return;
    setSubmitting(true);
    // Sesi AE-31 — kalau replaceAll, hapus existing dulu (transaction
    // terpisah dari bulk import). Owner perlu confirm via UI sebelum
    // sampai sini.
    let deletedBefore = 0;
    if (replaceAll) {
      const delRes = await deleteAllMarketItems();
      if (!isOk(delRes)) {
        setSubmitting(false);
        toast.error(`Replace gagal: ${delRes.error.message}`);
        return;
      }
      deletedBefore = delRes.data.deletedCount;
    }
    const res = await bulkImportMarketList({
      rows: parsed.rows,
      createMissing,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    const r = res.data;
    if (deletedBefore > 0) {
      toast.info(
        `${deletedBefore} entry lama dihapus sebelum import (replace mode)`,
      );
    }
    setImportResult(r);
    if (r.inserted + r.updated > 0) {
      toast.success(
        `Import selesai: ${r.inserted} baru, ${r.updated} update${
          r.suppliersCreated > 0 ? `, ${r.suppliersCreated} supplier baru` : ""
        }${
          r.ingredientsCreated > 0
            ? `, ${r.ingredientsCreated} bahan baru`
            : ""
        }`,
      );
      // Trigger parent refresh tapi JANGAN close modal — owner perlu lihat
      // result detail terutama kalau ada error.
      onImported();
    } else {
      toast.error("Tidak ada baris yang berhasil di-import");
    }
  }

  function handleClose() {
    reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Import Market List dari CSV"
      description="Format header: supplier, bahan, harga, pack_size, pack_unit, primary (opsional), notes (opsional). Match supplier + bahan by name (case-insensitive)."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={submitting}>
            {importResult ? "Selesai" : "Tutup"}
          </Button>
          {!importResult ? (
            <Button
              onClick={handleImport}
              loading={submitting}
              disabled={!parsed || parsed.rows.length === 0}
            >
              <Upload className="size-4" /> Import {parsed?.rows.length ?? 0}{" "}
              baris
            </Button>
          ) : (
            <Button onClick={() => reset()}>Import Lagi</Button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        {!importResult ? (
          <>
            <label className="block">
              <span className="text-xs font-medium text-neutral-700">
                File CSV
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
                className="mt-1 block w-full text-sm text-neutral-700 file:mr-3 file:rounded-md file:border-0 file:bg-mahakan-green-700 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-mahakan-green-900"
              />
              {fileName ? (
                <span className="mt-1 inline-block text-xs text-neutral-600">
                  {fileName}
                </span>
              ) : null}
            </label>

            <details className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
              <summary className="cursor-pointer font-semibold">
                Contoh format CSV (klik untuk lihat)
              </summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-neutral-700">
{`supplier,bahan,harga,pack_size,pack_unit,primary,notes
Pasar Cisarua,Bawang Bombay,36000,1000,gr,yes,
Toko Indah,Beras,12000,1,Kg,no,promo Mei
CV Sumber,Ayam Fillet,57000,1000,gr,yes,`}
              </pre>
            </details>

            {/* Sesi AE-27 — checkbox auto-create. Solves "import gagal"
             * issue saat supplier/bahan di CSV belum ada di master. */}
            <label className="flex items-start gap-2 rounded-lg border border-mahakan-green-700/30 bg-mahakan-green-50 p-3">
              <input
                type="checkbox"
                checked={createMissing}
                onChange={(e) => setCreateMissing(e.target.checked)}
                className="mt-0.5 size-4 accent-mahakan-green-700"
              />
              <span className="text-xs text-neutral-700">
                <span className="font-semibold text-mahakan-green-900">
                  Buat supplier / bahan baru otomatis kalau belum ada
                </span>
                <br />
                Direkomendasikan ON saat first-time import. Master baru
                ditandai notes &quot;Auto-created saat import&quot; di tab
                Supplier &amp; Bahan supaya owner gampang review.
              </span>
            </label>

            {/* Sesi AE-31 — replace mode untuk re-import bersih. */}
            <label className="flex items-start gap-2 rounded-lg border border-danger-300 bg-danger-100/30 p-3">
              <input
                type="checkbox"
                checked={replaceAll}
                onChange={(e) => setReplaceAll(e.target.checked)}
                className="mt-0.5 size-4 accent-danger-500"
              />
              <span className="text-xs text-neutral-700">
                <span className="font-semibold text-danger-500">
                  ⚠️ Replace mode — hapus SEMUA entry lama sebelum import
                </span>
                <br />
                Cocok untuk re-import bersih (mis. data lama parsing
                salah). Master Bahan + Supplier TIDAK ikut terhapus,
                cuma row Market List. Hati-hati: tidak bisa di-undo.
              </span>
            </label>

            {parsed ? (
              <div className="rounded-lg border border-neutral-200 bg-white p-3">
                <p className="text-sm font-semibold text-neutral-900">
                  Preview: {parsed.rows.length} baris valid
                </p>
                {parsed.warnings.length > 0 ? (
                  <div className="mt-2 max-h-40 overflow-y-auto rounded-md bg-warning-100 p-2 text-xs text-warning-500">
                    {parsed.warnings.map((w, i) => (
                      <div key={i}>⚠️ {w}</div>
                    ))}
                  </div>
                ) : null}
                {parsed.rows.length > 0 ? (
                  <div className="mt-2 max-h-60 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-neutral-100 text-left">
                        <tr>
                          <th className="px-2 py-1">Supplier</th>
                          <th className="px-2 py-1">Bahan</th>
                          <th className="px-2 py-1 text-right">Harga</th>
                          <th className="px-2 py-1">Pack</th>
                          <th className="px-2 py-1">Primary</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsed.rows.slice(0, 50).map((r, i) => (
                          <tr key={i} className="border-b border-neutral-100">
                            <td className="px-2 py-1">{r.supplierName}</td>
                            <td className="px-2 py-1">{r.ingredientName}</td>
                            <td className="px-2 py-1 text-right font-mono">
                              {new Intl.NumberFormat("id-ID").format(r.unitCost)}
                            </td>
                            <td className="px-2 py-1 font-mono">
                              {r.packSize} {r.packUnit}
                            </td>
                            <td className="px-2 py-1">
                              {r.isPrimary ? "✓" : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {parsed.rows.length > 50 ? (
                      <p className="mt-1 text-xs text-neutral-500">
                        +{parsed.rows.length - 50} baris lainnya…
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <ImportResultPanel result={importResult} />
        )}
      </div>
    </Modal>
  );
}

/** Sesi AE-27 — result modal tetap tampil setelah import biar owner
 *  tau persis berapa yg masuk + error apa. Sebelumnya auto-close + cuma
 *  toast singkat → owner gak tau kenapa "import gagal". */
function ImportResultPanel({ result }: { result: BulkImportResult }) {
  const success = result.inserted + result.updated;
  const hasErrors = result.errors.length > 0;
  return (
    <div className="space-y-3">
      <div
        className={
          "rounded-lg border p-4 " +
          (success > 0
            ? "border-success-500/30 bg-success-100/40"
            : "border-warning-500/30 bg-warning-100/40")
        }
      >
        <div className="flex items-center gap-2">
          {success > 0 ? (
            <CheckCircle2 className="size-5 text-success-500" />
          ) : (
            <XCircle className="size-5 text-warning-500" />
          )}
          <span className="text-base font-semibold">
            Import {success > 0 ? "Selesai" : "Tidak ada yg masuk"}
          </span>
        </div>
        <ul className="mt-2 space-y-1 text-sm">
          <li>
            ✓ <strong>{result.inserted}</strong> baris baru ditambah
          </li>
          <li>
            ✓ <strong>{result.updated}</strong> baris di-update
          </li>
          {result.suppliersCreated > 0 ? (
            <li>
              ✓ <strong>{result.suppliersCreated}</strong> supplier baru
              dibuat otomatis
            </li>
          ) : null}
          {result.ingredientsCreated > 0 ? (
            <li>
              ✓ <strong>{result.ingredientsCreated}</strong> bahan baru
              dibuat otomatis
            </li>
          ) : null}
          {result.skipped > 0 ? (
            <li className="text-warning-500">
              ⚠️ <strong>{result.skipped}</strong> baris di-skip (lihat detail
              di bawah)
            </li>
          ) : null}
        </ul>
      </div>

      {hasErrors ? (
        <details
          open
          className="rounded-lg border border-danger-300 bg-white p-3"
        >
          <summary className="cursor-pointer text-sm font-semibold text-danger-500">
            {result.errors.length} baris error / skip
          </summary>
          <div className="mt-2 max-h-60 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-neutral-100 text-left">
                <tr>
                  <th className="px-2 py-1 w-16">Baris</th>
                  <th className="px-2 py-1">Pesan</th>
                </tr>
              </thead>
              <tbody>
                {result.errors.slice(0, 50).map((e, i) => (
                  <tr key={i} className="border-b border-neutral-100">
                    <td className="px-2 py-1 font-mono">#{e.row}</td>
                    <td className="px-2 py-1 text-danger-500">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.errors.length > 50 ? (
              <p className="mt-1 text-xs text-neutral-500">
                +{result.errors.length - 50} error lainnya…
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}
