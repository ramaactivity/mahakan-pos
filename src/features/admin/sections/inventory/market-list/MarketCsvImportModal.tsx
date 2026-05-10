"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { Button, Modal, toast } from "@/components/ui";
import { bulkImportMarketList, isOk } from "@/features/market-list";

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
    const hargaRaw = (cells[idx.harga] ?? "").replace(/[^\d.-]/g, "");
    const sizeRaw = (cells[idx.packSize] ?? "").replace(",", ".");
    const packUnit = cells[idx.packUnit]?.trim() ?? "";
    const isPrimaryStr =
      idx.primary !== -1 ? (cells[idx.primary] ?? "").trim().toLowerCase() : "";
    const notes =
      idx.notes !== -1 ? (cells[idx.notes] ?? "").trim() || null : null;
    if (!supplierName || !ingredientName) {
      warnings.push(`Baris ${i + 1}: supplier / bahan kosong, skip`);
      continue;
    }
    const unitCost = parseInt(hargaRaw, 10);
    const packSize = parseFloat(sizeRaw);
    if (!Number.isFinite(unitCost) || unitCost <= 0) {
      warnings.push(`Baris ${i + 1}: harga invalid (${cells[idx.harga]}), skip`);
      continue;
    }
    if (!Number.isFinite(packSize) || packSize <= 0) {
      warnings.push(
        `Baris ${i + 1}: pack_size invalid (${cells[idx.packSize]}), skip`,
      );
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

  function reset() {
    setParsed(null);
    setSubmitting(false);
    setFileName("");
  }

  async function handleFile(file: File) {
    setFileName(file.name);
    const text = await file.text();
    setParsed(parseCsv(text));
  }

  async function handleImport() {
    if (!parsed || parsed.rows.length === 0 || submitting) return;
    setSubmitting(true);
    const res = await bulkImportMarketList({ rows: parsed.rows });
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    const r = res.data;
    toast.success(
      `Import selesai: ${r.inserted} baru, ${r.updated} update, ${r.skipped} skip`,
    );
    if (r.errors.length > 0) {
      console.warn("Bulk import errors:", r.errors);
    }
    onImported();
    reset();
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Import Market List dari CSV"
      description="Format header: supplier, bahan, harga, pack_size, pack_unit, primary (opsional), notes (opsional). Match supplier + bahan by name (case-insensitive)."
      size="lg"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={submitting}
          >
            Tutup
          </Button>
          <Button
            onClick={handleImport}
            loading={submitting}
            disabled={!parsed || parsed.rows.length === 0}
          >
            <Upload className="size-4" /> Import {parsed?.rows.length ?? 0} baris
          </Button>
        </>
      }
    >
      <div className="space-y-3">
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
      </div>
    </Modal>
  );
}
