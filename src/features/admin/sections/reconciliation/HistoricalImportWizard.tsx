"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  Loader2,
  Sliders,
  Upload,
} from "lucide-react";
import { Button, Card, CardContent, Input, toast } from "@/components/ui";
import {
  buildHistoricalSummaryTemplate,
  bulkImportHistoricalSummary,
  isOk,
  parseCsvLine,
  parseHistoricalCsv,
  suggestColumnMapping,
  type CsvColumnMapping,
  type ParseResult,
} from "@/features/historical";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

type Step = 1 | 2 | 3 | 4;

const FIELD_LABELS: Array<{
  key: keyof CsvColumnMapping;
  label: string;
  required?: boolean;
  hint?: string;
}> = [
  { key: "date", label: "Tanggal", required: true, hint: "Wajib" },
  { key: "grossRevenue", label: "Penjualan Bruto" },
  { key: "totalRefund", label: "Refund" },
  { key: "totalVoid", label: "Void" },
  { key: "totalDiscount", label: "Diskon" },
  { key: "netRevenue", label: "Penjualan Bersih" },
  { key: "transactionCount", label: "Jumlah Transaksi" },
  { key: "cogs", label: "HPP / COGS" },
  { key: "cashIn", label: "Cash" },
  { key: "qrisIn", label: "QRIS" },
  { key: "edcIn", label: "EDC / Debit" },
  { key: "aggregatorIn", label: "Aggregator (GoFood / GrabFood / ShopeeFood)" },
];

export function HistoricalImportWizard() {
  const [step, setStep] = useState<Step>(1);
  const [csvText, setCsvText] = useState("");
  const [filename, setFilename] = useState("");
  const [mapping, setMapping] = useState<Partial<CsvColumnMapping>>({});
  const [sourceLabel, setSourceLabel] = useState("");
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    inserted: number;
    updated: number;
    total: number;
    from: string;
    to: string;
  } | null>(null);

  const headers = useMemo(() => {
    if (!csvText) return [];
    const firstLine = csvText.split(/\r?\n/)[0] ?? "";
    return parseCsvLine(firstLine);
  }, [csvText]);

  const previewRows = useMemo(() => {
    if (!csvText) return [];
    return csvText.split(/\r?\n/).slice(1, 6).map((l) => parseCsvLine(l));
  }, [csvText]);

  async function handleFile(file: File) {
    const text = await file.text();
    setCsvText(text);
    setFilename(file.name);
    // Auto-suggest mapping
    const firstLine = text.split(/\r?\n/)[0] ?? "";
    const hdrs = parseCsvLine(firstLine);
    const suggested = suggestColumnMapping(hdrs);
    setMapping(suggested);
    setSourceLabel(
      `${file.name.replace(/\.csv$/i, "")} — ${new Date().toLocaleDateString("id-ID")}`,
    );
  }

  function handleParsePreview() {
    if (!mapping.date) {
      toast.error("Kolom tanggal wajib diisi");
      return;
    }
    const result = parseHistoricalCsv(csvText, mapping as CsvColumnMapping);
    setParseResult(result);
    if (result.errors.length > 0 && result.rows.length === 0) {
      toast.error(`Gagal parse: ${result.errors[0]}`);
      return;
    }
    setStep(3);
  }

  async function handleConfirmImport() {
    if (!parseResult) return;
    if (parseResult.rows.length === 0) {
      toast.error("Tidak ada baris valid untuk di-import");
      return;
    }
    setImporting(true);
    try {
      const res = await bulkImportHistoricalSummary({
        rows: parseResult.rows.map((r) => ({
          businessDate: r.businessDate,
          grossRevenue: r.grossRevenue,
          totalRefund: r.totalRefund,
          totalVoid: r.totalVoid,
          totalDiscount: r.totalDiscount,
          netRevenue: r.netRevenue,
          transactionCount: r.transactionCount,
          cogs: r.cogs,
          cashIn: r.cashIn,
          qrisIn: r.qrisIn,
          edcIn: r.edcIn,
          aggregatorIn: r.aggregatorIn,
        })),
        sourceLabel: sourceLabel || filename || "Manual import",
      });
      if (!isOk(res)) {
        toast.error(res.error.message);
        return;
      }
      setImportResult({
        inserted: res.data.inserted,
        updated: res.data.updated,
        total: res.data.total,
        from: res.data.dateRange.from,
        to: res.data.dateRange.to,
      });
      toast.success(
        `Berhasil import ${res.data.total} baris (${res.data.inserted} baru, ${res.data.updated} update)`,
      );
      setStep(4);
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setStep(1);
    setCsvText("");
    setFilename("");
    setMapping({});
    setSourceLabel("");
    setParseResult(null);
    setImportResult(null);
  }

  return (
    <div className="space-y-4 p-6">
      <StepIndicator step={step} />

      {step === 1 ? (
        <Step1Upload onFile={handleFile} csvText={csvText} filename={filename} onNext={() => setStep(2)} />
      ) : step === 2 ? (
        <Step2Mapping
          headers={headers}
          previewRows={previewRows}
          mapping={mapping}
          setMapping={setMapping}
          sourceLabel={sourceLabel}
          setSourceLabel={setSourceLabel}
          onBack={() => setStep(1)}
          onNext={handleParsePreview}
        />
      ) : step === 3 ? (
        <Step3Preview
          parseResult={parseResult}
          sourceLabel={sourceLabel}
          importing={importing}
          onBack={() => setStep(2)}
          onConfirm={handleConfirmImport}
        />
      ) : (
        <Step4Done importResult={importResult} onReset={reset} />
      )}
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const steps = [
    { n: 1, label: "Upload CSV", Icon: Upload },
    { n: 2, label: "Mapping Kolom", Icon: Sliders },
    { n: 3, label: "Preview & Validasi", Icon: FileSpreadsheet },
    { n: 4, label: "Selesai", Icon: CheckCircle2 },
  ] as const;
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, idx) => {
        const active = step === s.n;
        const done = step > s.n;
        const Icon = s.Icon;
        return (
          <div key={s.n} className="flex items-center gap-2">
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
                active
                  ? "bg-mahakan-green-700 text-white"
                  : done
                    ? "bg-success-100 text-success-700"
                    : "bg-neutral-100 text-neutral-500",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">
                {s.n}. {s.label}
              </span>
              <span className="sm:hidden">{s.n}</span>
            </div>
            {idx < steps.length - 1 ? (
              <ArrowRight className="size-3 text-neutral-300" aria-hidden />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Step1Upload({
  onFile,
  csvText,
  filename,
  onNext,
}: {
  onFile: (file: File) => void;
  csvText: string;
  filename: string;
  onNext: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  function downloadTemplate() {
    const csv = buildHistoricalSummaryTemplate();
    const blob = new Blob(["﻿" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `template-historis-mahakan-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-mahakan-green-900">
              Step 1 — Upload CSV
            </h2>
            <p className="mt-1 text-sm text-neutral-600">
              Pilih file CSV export dari Majoo/Kasir Pintar (atau buat manual
              via Excel/Sheets, save as CSV). 1 baris = 1 hari penjualan.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={downloadTemplate}
            title="Download template kosong dengan kolom pre-mapped"
          >
            <Download className="size-4" aria-hidden /> Template CSV
          </Button>
        </div>

        <div className="rounded-md border border-mahakan-green-300/40 bg-mahakan-green-50/30 p-3 text-xs text-neutral-700">
          <p>
            <strong>Tip:</strong> Klik &ldquo;Template CSV&rdquo; di kanan atas
            untuk download file kosong dengan kolom yang sudah pre-mapped.
            Buka di Excel/Google Sheets, isi data per hari, save as CSV, lalu
            upload di sini. Mapping otomatis ke-detect tanpa perlu edit ulang.
          </p>
        </div>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) onFile(file);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-12 text-center transition-colors",
            dragOver
              ? "border-mahakan-green-700 bg-mahakan-green-50/40"
              : "border-neutral-300 bg-neutral-50/30 hover:border-mahakan-green-500/60",
          )}
        >
          <Upload className="size-8 text-neutral-400" aria-hidden />
          <div className="text-sm font-medium text-neutral-900">
            Drop CSV di sini atau klik untuk pilih
          </div>
          <div className="text-xs text-neutral-500">
            Maksimal 1000 baris per file. Encoding UTF-8 atau ISO-8859.
          </div>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
            }}
          />
        </label>

        {csvText ? (
          <div className="rounded-md bg-success-50/40 border border-success-500/30 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-success-700">
              <CheckCircle2 className="size-4" aria-hidden />
              File ter-load: {filename}
            </div>
            <div className="mt-0.5 text-xs text-neutral-600">
              {csvText.split(/\r?\n/).filter((l) => l.trim()).length - 1} baris
              data terdeteksi
            </div>
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button onClick={onNext} disabled={!csvText}>
            Lanjut <ArrowRight className="size-4" aria-hidden />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Step2Mapping({
  headers,
  previewRows,
  mapping,
  setMapping,
  sourceLabel,
  setSourceLabel,
  onBack,
  onNext,
}: {
  headers: string[];
  previewRows: string[][];
  mapping: Partial<CsvColumnMapping>;
  setMapping: (m: Partial<CsvColumnMapping>) => void;
  sourceLabel: string;
  setSourceLabel: (s: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div>
          <h2 className="text-base font-bold text-mahakan-green-900">
            Step 2 — Mapping Kolom
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            Cocokkan kolom CSV ke field sistem. Kolom yang sudah auto-detect
            tampil terisi (boleh di-override). Field tanpa kolom yang cocok
            akan default 0.
          </p>
        </div>

        {/* Preview 5 baris */}
        <div className="overflow-x-auto rounded-md border border-neutral-200">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50">
              <tr>
                {headers.map((h) => (
                  <th
                    key={h}
                    className="border-r border-neutral-200 px-2 py-1.5 text-left font-medium text-neutral-700 last:border-r-0"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, i) => (
                <tr
                  key={i}
                  className="border-t border-neutral-200 odd:bg-white even:bg-neutral-50/40"
                >
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className="border-r border-neutral-100 px-2 py-1 font-mono text-neutral-700 last:border-r-0"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mapping fields */}
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELD_LABELS.map((f) => (
            <div key={f.key}>
              <label className="text-xs font-medium text-neutral-700">
                {f.label}
                {f.required ? (
                  <span className="ml-1 text-danger-500">*</span>
                ) : null}
              </label>
              <select
                value={mapping[f.key] ?? ""}
                onChange={(e) =>
                  setMapping({
                    ...mapping,
                    [f.key]: e.target.value || undefined,
                  })
                }
                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
              >
                <option value="">
                  {f.required ? "(pilih kolom)" : "(skip / default 0)"}
                </option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div>
          <label className="text-xs font-medium text-neutral-700">
            Label Sumber (untuk audit)
          </label>
          <Input
            value={sourceLabel}
            onChange={(e) => setSourceLabel(e.target.value)}
            placeholder="Mis. Majoo CSV Nov 2025 - Apr 2026"
            className="mt-1"
          />
        </div>

        <div className="flex justify-between">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="size-4" aria-hidden /> Kembali
          </Button>
          <Button onClick={onNext} disabled={!mapping.date}>
            Parse & Preview <ArrowRight className="size-4" aria-hidden />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Step3Preview({
  parseResult,
  sourceLabel,
  importing,
  onBack,
  onConfirm,
}: {
  parseResult: ParseResult | null;
  sourceLabel: string;
  importing: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  if (!parseResult) return null;
  const { rows, warnings, errors } = parseResult;
  const totals = rows.reduce(
    (acc, r) => ({
      gross: acc.gross + r.grossRevenue,
      net: acc.net + r.netRevenue,
      cogs: acc.cogs + r.cogs,
      trx: acc.trx + r.transactionCount,
    }),
    { gross: 0, net: 0, cogs: 0, trx: 0 },
  );
  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-4">
        <StatBox
          label="Baris valid"
          value={String(rows.length)}
          tone={rows.length > 0 ? "success" : "danger"}
        />
        <StatBox
          label="Total Bruto"
          value={formatRupiah(totals.gross)}
          tone="neutral"
        />
        <StatBox
          label="Total Bersih"
          value={formatRupiah(totals.net)}
          tone="neutral"
        />
        <StatBox label="Total Trx" value={String(totals.trx)} tone="neutral" />
      </div>

      {/* Errors */}
      {errors.length > 0 ? (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle
                className="mt-0.5 size-5 shrink-0 text-danger-500"
                aria-hidden
              />
              <div>
                <h3 className="text-sm font-semibold text-danger-700">
                  {errors.length} error
                </h3>
                <ul className="mt-1 space-y-0.5 text-xs text-neutral-700">
                  {errors.slice(0, 10).map((e, i) => (
                    <li key={i}>· {e}</li>
                  ))}
                  {errors.length > 10 ? (
                    <li className="italic text-neutral-500">
                      ...dan {errors.length - 10} error lainnya
                    </li>
                  ) : null}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Warnings */}
      {warnings.length > 0 ? (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle
                className="mt-0.5 size-5 shrink-0 text-warning-500"
                aria-hidden
              />
              <div>
                <h3 className="text-sm font-semibold text-warning-700">
                  {warnings.length} warning
                </h3>
                <ul className="mt-1 space-y-0.5 text-xs text-neutral-700">
                  {warnings.slice(0, 10).map((w, i) => (
                    <li key={i}>· {w}</li>
                  ))}
                  {warnings.length > 10 ? (
                    <li className="italic text-neutral-500">
                      ...dan {warnings.length - 10} warning lainnya
                    </li>
                  ) : null}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Preview table */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-neutral-900">
              Preview Data ({rows.length} baris)
            </h3>
            <span className="text-xs text-neutral-500">
              Sumber: {sourceLabel}
            </span>
          </div>
          <div className="max-h-96 overflow-auto rounded-md border border-neutral-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-neutral-100 text-neutral-700">
                <tr>
                  <th className="px-2 py-1.5 text-left">Tanggal</th>
                  <th className="px-2 py-1.5 text-right">Bruto</th>
                  <th className="px-2 py-1.5 text-right">Refund</th>
                  <th className="px-2 py-1.5 text-right">Diskon</th>
                  <th className="px-2 py-1.5 text-right">Bersih</th>
                  <th className="px-2 py-1.5 text-right">HPP</th>
                  <th className="px-2 py-1.5 text-right">Trx</th>
                  <th className="px-2 py-1.5 text-right">Cash</th>
                  <th className="px-2 py-1.5 text-right">QRIS</th>
                  <th className="px-2 py-1.5 text-right">EDC</th>
                  <th className="px-2 py-1.5 text-right">Aggregator</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.businessDate}
                    className="border-t border-neutral-100 font-mono"
                  >
                    <td className="px-2 py-1">{r.businessDate}</td>
                    <td className="px-2 py-1 text-right">
                      {formatRupiah(r.grossRevenue)}
                    </td>
                    <td className="px-2 py-1 text-right text-neutral-500">
                      {r.totalRefund ? formatRupiah(r.totalRefund) : "—"}
                    </td>
                    <td className="px-2 py-1 text-right text-neutral-500">
                      {r.totalDiscount ? formatRupiah(r.totalDiscount) : "—"}
                    </td>
                    <td className="px-2 py-1 text-right font-semibold">
                      {formatRupiah(r.netRevenue)}
                    </td>
                    <td className="px-2 py-1 text-right text-neutral-500">
                      {r.cogs ? formatRupiah(r.cogs) : "—"}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {r.transactionCount}
                    </td>
                    <td className="px-2 py-1 text-right text-neutral-500">
                      {r.cashIn ? formatRupiah(r.cashIn) : "—"}
                    </td>
                    <td className="px-2 py-1 text-right text-neutral-500">
                      {r.qrisIn ? formatRupiah(r.qrisIn) : "—"}
                    </td>
                    <td className="px-2 py-1 text-right text-neutral-500">
                      {r.edcIn ? formatRupiah(r.edcIn) : "—"}
                    </td>
                    <td className="px-2 py-1 text-right text-neutral-500">
                      {r.aggregatorIn ? formatRupiah(r.aggregatorIn) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} disabled={importing}>
          <ArrowLeft className="size-4" aria-hidden /> Kembali
        </Button>
        <Button
          onClick={onConfirm}
          disabled={rows.length === 0 || importing}
        >
          {importing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Database className="size-4" aria-hidden />
          )}{" "}
          Import {rows.length} baris
        </Button>
      </div>
    </div>
  );
}

function Step4Done({
  importResult,
  onReset,
}: {
  importResult: {
    inserted: number;
    updated: number;
    total: number;
    from: string;
    to: string;
  } | null;
  onReset: () => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-8 text-center">
        <CheckCircle2
          className="mx-auto size-12 text-success-500"
          aria-hidden
        />
        <h2 className="text-lg font-bold text-mahakan-green-900">
          Import Berhasil
        </h2>
        {importResult ? (
          <div className="text-sm text-neutral-700">
            <p>
              <strong>{importResult.total}</strong> baris di-import (
              <span className="text-success-700">
                {importResult.inserted} baru
              </span>
              {importResult.updated > 0 ? (
                <>
                  {" "}
                  <span className="text-warning-700">
                    {importResult.updated} update existing
                  </span>
                </>
              ) : null}
              ).
            </p>
            <p className="mt-1 text-neutral-500">
              Range: {importResult.from} → {importResult.to}
            </p>
          </div>
        ) : null}
        <p className="text-sm text-neutral-600">
          Data sudah masuk ke laporan dengan badge &ldquo;Histori&rdquo;.
          Cek tab <em>Daftar Historis</em> untuk lihat hasil, atau buka{" "}
          <em>Laporan → Daily Sales</em>.
        </p>
        <div className="flex justify-center gap-2">
          <Button variant="outline" onClick={onReset}>
            Import File Lain
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StatBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "success" | "warning" | "danger" | "neutral";
}) {
  const toneClass = {
    success: "border-success-500/30 bg-success-50/40",
    warning: "border-warning-500/30 bg-warning-50/40",
    danger: "border-danger-500/30 bg-danger-50/40",
    neutral: "border-neutral-200 bg-white",
  }[tone];
  return (
    <div className={cn("rounded-lg border p-3", toneClass)}>
      <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-600">
        {label}
      </div>
      <div className="mt-1 text-lg font-bold text-neutral-900">{value}</div>
    </div>
  );
}
