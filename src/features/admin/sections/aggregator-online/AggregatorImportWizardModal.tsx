"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Sliders,
  Upload,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Modal,
  Select,
  toast,
} from "@/components/ui";
import {
  aggregateDaily,
  aggregateSinglePeriod,
  parseAggregatorCsv,
  type CsvColumnMapping,
  type ParseCsvResult,
  type ParsedSettlementRow,
} from "@/features/finance/aggregator-csv-parser";
import { createAggregatorSettlement } from "@/features/finance/actions";
import type { AggregatorLineItem } from "@/features/finance/types";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { todayJakarta } from "@/lib/tz";

/**
 * Sesi AE-77 — 4-step wizard untuk import CSV settlement aggregator/cashless.
 *
 * Steps:
 *   1. Pilih channel + upload CSV (plus tombol download template per channel).
 *   2. Preview rows + column mapping (auto-detected, manual override option).
 *   3. Pilih aggregation mode (per hari atau total seluruh periode).
 *   4. Confirm + submit → call createAggregatorSettlement per aggregated row.
 *      Tiap settlement carry line_items[] dari rows asli untuk drilldown.
 *
 * Replace older AggregatorSettlementModal (yang single-step). Pattern mirror
 * HistoricalImportWizard untuk konsistensi UX.
 */

type Step = 1 | 2 | 3 | 4;
type Channel = "gofood" | "grabfood" | "shopeefood" | "qris" | "edc_bca";
type AggregationMode = "daily" | "single";

const CHANNEL_OPTIONS: Array<{
  value: Channel;
  label: string;
  hint: string;
  templateHeaders: string[];
  sampleRow: string[];
}> = [
  {
    value: "gofood",
    label: "GoFood",
    hint: "Export 'Riwayat Pesanan' / 'Settlement' dari merchant.gobiz.co.id",
    templateHeaders: [
      "Tanggal Pesanan",
      "No Order",
      "Customer",
      "Total Pemasukan",
      "Komisi GoFood",
      "Pemasukan Bersih",
      "Catatan",
    ],
    sampleRow: [
      "2026-05-21",
      "GF-1234567",
      "Budi",
      "75000",
      "15000",
      "60000",
      "Cashback diskon",
    ],
  },
  {
    value: "grabfood",
    label: "GrabFood",
    hint: "Export dari Grab Merchant — Sales Report / Settlement Report",
    templateHeaders: [
      "Order Date",
      "Order ID",
      "Customer Name",
      "Gross Amount",
      "Commission",
      "Net Amount",
      "Note",
    ],
    sampleRow: [
      "2026-05-21",
      "GRB-9876543",
      "Andi",
      "85000",
      "17000",
      "68000",
      "",
    ],
  },
  {
    value: "shopeefood",
    label: "ShopeeFood",
    hint: "Export dari Shopee Partner Center → Reports",
    templateHeaders: [
      "Tanggal Transaksi",
      "Nomor Order",
      "Nama Customer",
      "Subtotal",
      "Biaya Komisi",
      "Net",
      "Notes",
    ],
    sampleRow: [
      "2026-05-21",
      "SPF-2233445",
      "Citra",
      "55000",
      "8800",
      "46200",
      "",
    ],
  },
  {
    value: "qris",
    label: "QRIS",
    hint: "Export dari aggregator QRIS (BCA, Mandiri, dll) atau payment processor",
    templateHeaders: [
      "Tanggal",
      "Reference No",
      "Customer",
      "Gross",
      "MDR",
      "Net",
      "Catatan",
    ],
    sampleRow: [
      "2026-05-21",
      "QR-20260521-001",
      "",
      "50000",
      "350",
      "49650",
      "",
    ],
  },
  {
    value: "edc_bca",
    label: "EDC BCA",
    hint: "Export rekap EDC dari KlikBCA Bisnis → Settlement Statement",
    templateHeaders: [
      "Tanggal",
      "Trace No",
      "Card Type",
      "Gross",
      "MDR",
      "Net",
      "Catatan",
    ],
    sampleRow: [
      "2026-05-21",
      "EDC-998877",
      "Debit BCA",
      "120000",
      "840",
      "119160",
      "",
    ],
  },
];

interface AggregatorImportWizardModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function AggregatorImportWizardModal({
  open,
  onClose,
  onSaved,
}: AggregatorImportWizardModalProps) {
  const [step, setStep] = useState<Step>(1);
  const [channel, setChannel] = useState<Channel>("gofood");
  const [csvText, setCsvText] = useState("");
  const [filename, setFilename] = useState("");
  const [mapping, setMapping] = useState<Partial<CsvColumnMapping>>({});
  const [orderNoCol, setOrderNoCol] = useState<string>("");
  const [customerCol, setCustomerCol] = useState<string>("");
  const [notesCol, setNotesCol] = useState<string>("");
  const [aggMode, setAggMode] = useState<AggregationMode>("daily");
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    ok: number;
    fail: number;
    errors: string[];
  } | null>(null);

  function reset() {
    setStep(1);
    setCsvText("");
    setFilename("");
    setMapping({});
    setOrderNoCol("");
    setCustomerCol("");
    setNotesCol("");
    setAggMode("daily");
    setReferenceNo("");
    setNotes("");
    setSubmitting(false);
    setSubmitResult(null);
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  // Parse CSV with current mapping (memoized)
  const parsedHeaders = useMemo(() => {
    if (!csvText) return [];
    const firstLine = csvText.split(/\r?\n/)[0] ?? "";
    return firstLine.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ""));
  }, [csvText]);

  const parseResult: ParseCsvResult | null = useMemo(() => {
    if (!csvText || !mapping.dateColumn || !mapping.grossColumn) return null;
    return parseAggregatorCsv(csvText, {
      mapping: mapping as CsvColumnMapping,
    });
  }, [csvText, mapping]);

  const lineItems = useMemo((): AggregatorLineItem[] => {
    if (!parseResult || parseResult.rows.length === 0) return [];
    return parseResult.rows.map((r) =>
      buildLineItem(r, csvText, {
        orderNoCol,
        customerCol,
        notesCol,
      }),
    );
  }, [parseResult, csvText, orderNoCol, customerCol, notesCol]);

  const groupedItems = useMemo(() => {
    if (lineItems.length === 0) return [];
    if (aggMode === "daily") {
      const dailyAggs = aggregateDaily(parseResult?.rows ?? []);
      return dailyAggs.map((agg) => ({
        periodFrom: agg.periodFrom,
        periodTo: agg.periodTo,
        gross: agg.grossAmount,
        fee: agg.feeAmount,
        net: agg.netAmount,
        items: lineItems.filter((li) => li.date === agg.periodFrom),
      }));
    }
    const single = aggregateSinglePeriod(parseResult?.rows ?? []);
    if (!single) return [];
    return [
      {
        periodFrom: single.periodFrom,
        periodTo: single.periodTo,
        gross: single.grossAmount,
        fee: single.feeAmount,
        net: single.netAmount,
        items: lineItems,
      },
    ];
  }, [aggMode, lineItems, parseResult]);

  async function handleFile(file: File) {
    const text = await file.text();
    setCsvText(text);
    setFilename(file.name);
    // Auto-detect mapping
    const firstLine = text.split(/\r?\n/)[0] ?? "";
    const headers = firstLine.split(/[,;\t]/).map((c) =>
      c.trim().replace(/^"|"$/g, ""),
    );
    const lowerHeaders = headers.map((h) => h.toLowerCase());
    const findIdx = (kws: string[]): string | undefined => {
      for (let i = 0; i < lowerHeaders.length; i++) {
        if (kws.some((kw) => lowerHeaders[i].includes(kw))) return headers[i];
      }
      return undefined;
    };
    const dateHdr =
      findIdx(["tanggal", "date", "tgl", "waktu"]) ?? headers[0];
    const grossHdr =
      findIdx(["gross", "total", "subtotal", "omset", "omzet", "amount"]) ??
      headers[3] ??
      undefined;
    const feeHdr = findIdx(["fee", "komisi", "commission", "mdr", "biaya"]);
    const netHdr = findIdx(["net", "bersih", "diterima", "payout"]);
    const orderHdr = findIdx(["order", "no order", "nomor", "id pesanan"]);
    const customerHdr = findIdx(["customer", "pelanggan", "pembeli", "nama"]);
    const noteHdr = findIdx(["catatan", "note", "remark"]);
    setMapping({
      dateColumn: dateHdr ?? "",
      grossColumn: grossHdr ?? "",
      feeColumn: feeHdr,
      netColumn: netHdr,
    });
    setOrderNoCol(orderHdr ?? "");
    setCustomerCol(customerHdr ?? "");
    setNotesCol(noteHdr ?? "");
  }

  function downloadTemplate() {
    const opt = CHANNEL_OPTIONS.find((c) => c.value === channel);
    if (!opt) return;
    const csv =
      opt.templateHeaders.join(",") + "\n" + opt.sampleRow.join(",") + "\n";
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `template-${channel}-${todayJakarta()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Template ${opt.label} di-download`);
  }

  async function handleSubmit() {
    if (submitting || groupedItems.length === 0) return;
    setSubmitting(true);
    setSubmitResult(null);
    let okCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    for (const group of groupedItems) {
      try {
        const res = await createAggregatorSettlement({
          channel,
          periodFrom: group.periodFrom,
          periodTo: group.periodTo,
          grossAmount: group.gross,
          feeAmount: group.fee,
          referenceNo: referenceNo.trim() || null,
          notes: notes.trim() || null,
          lineItems: group.items,
        });
        if (res.ok) {
          okCount++;
        } else {
          failCount++;
          errors.push(`${group.periodFrom}: ${res.error.message}`);
        }
      } catch (e) {
        failCount++;
        errors.push(
          `${group.periodFrom}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    setSubmitting(false);
    setSubmitResult({ ok: okCount, fail: failCount, errors });

    if (okCount > 0 && failCount === 0) {
      toast.success(`Berhasil import ${okCount} settlement`);
      onSaved();
    } else if (okCount > 0) {
      toast.success(`Sebagian: ${okCount} ok, ${failCount} gagal`);
    } else {
      toast.error(`Gagal semua (${failCount})`);
    }
  }

  function canProceed(): boolean {
    if (step === 1) return !!csvText && !!filename;
    if (step === 2)
      return (
        !!mapping.dateColumn &&
        !!mapping.grossColumn &&
        parseResult != null &&
        parseResult.rows.length > 0
      );
    if (step === 3) return groupedItems.length > 0;
    return false;
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Import CSV Settlement"
      description="Upload CSV dari aggregator app (GoFood/GrabFood/ShopeeFood) atau cashless (QRIS/EDC). Auto-detect kolom + per-day aggregation."
      size="3xl"
      footer={
        step === 4 && submitResult ? (
          <Button onClick={handleClose}>Selesai</Button>
        ) : (
          <>
            {step > 1 ? (
              <Button
                variant="ghost"
                onClick={() => setStep((s) => (s > 1 ? ((s - 1) as Step) : s))}
                disabled={submitting}
              >
                <ArrowLeft className="size-4" aria-hidden /> Kembali
              </Button>
            ) : null}
            <Button variant="ghost" onClick={handleClose} disabled={submitting}>
              Batal
            </Button>
            {step < 4 ? (
              <Button
                onClick={() => setStep((s) => (s < 4 ? ((s + 1) as Step) : s))}
                disabled={!canProceed()}
              >
                Lanjut <ArrowRight className="size-4" aria-hidden />
              </Button>
            ) : (
              <Button onClick={handleSubmit} loading={submitting}>
                Import {groupedItems.length} Settlement
              </Button>
            )}
          </>
        )
      }
    >
      <div className="space-y-4">
        <StepIndicator step={step} />

        {step === 1 ? (
          <Step1
            channel={channel}
            setChannel={setChannel}
            csvText={csvText}
            filename={filename}
            onFile={handleFile}
            onDownloadTemplate={downloadTemplate}
          />
        ) : step === 2 ? (
          <Step2
            headers={parsedHeaders}
            mapping={mapping}
            setMapping={setMapping}
            orderNoCol={orderNoCol}
            setOrderNoCol={setOrderNoCol}
            customerCol={customerCol}
            setCustomerCol={setCustomerCol}
            notesCol={notesCol}
            setNotesCol={setNotesCol}
            parseResult={parseResult}
          />
        ) : step === 3 ? (
          <Step3
            aggMode={aggMode}
            setAggMode={setAggMode}
            referenceNo={referenceNo}
            setReferenceNo={setReferenceNo}
            notes={notes}
            setNotes={setNotes}
            groupedItems={groupedItems}
          />
        ) : (
          <Step4
            channel={channel}
            groupedItems={groupedItems}
            submitting={submitting}
            submitResult={submitResult}
          />
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------- Step UI ---------------------------------- */

function StepIndicator({ step }: { step: Step }) {
  const steps = [
    { n: 1, label: "Upload", Icon: Upload },
    { n: 2, label: "Mapping", Icon: Sliders },
    { n: 3, label: "Aggregasi", Icon: FileSpreadsheet },
    { n: 4, label: "Selesai", Icon: CheckCircle2 },
  ] as const;
  return (
    <div className="flex items-center gap-1">
      {steps.map((s, idx) => {
        const active = step === s.n;
        const done = step > s.n;
        const Icon = s.Icon;
        return (
          <div key={s.n} className="flex items-center gap-1">
            <div
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium",
                active
                  ? "bg-mahakan-green-700 text-white"
                  : done
                    ? "bg-success-100 text-success-700"
                    : "bg-neutral-100 text-neutral-500",
              )}
            >
              <Icon className="size-3" aria-hidden />
              <span>
                {s.n}. {s.label}
              </span>
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

function Step1({
  channel,
  setChannel,
  csvText,
  filename,
  onFile,
  onDownloadTemplate,
}: {
  channel: Channel;
  setChannel: (c: Channel) => void;
  csvText: string;
  filename: string;
  onFile: (file: File) => Promise<void>;
  onDownloadTemplate: () => void;
}) {
  const opt = CHANNEL_OPTIONS.find((c) => c.value === channel);
  return (
    <div className="space-y-3">
      <Select
        label="Channel"
        options={CHANNEL_OPTIONS.map((c) => ({
          value: c.value,
          label: c.label,
        }))}
        value={channel}
        onValueChange={(v) => setChannel(v as Channel)}
      />
      {opt ? (
        <Card className="border-mahakan-green-200 bg-mahakan-green-50/40 p-3">
          <p className="text-xs text-neutral-700">{opt.hint}</p>
          <Button
            variant="outline"
            onClick={onDownloadTemplate}
            className="mt-2"
          >
            <Download className="size-4" aria-hidden /> Download Template{" "}
            {opt.label}
          </Button>
        </Card>
      ) : null}

      <div>
        <label className="block text-sm font-medium text-neutral-900">
          File CSV
        </label>
        <label className="mt-1.5 flex cursor-pointer flex-col items-center gap-2 rounded-md border-2 border-dashed border-neutral-300 bg-neutral-50/40 p-6 hover:border-mahakan-green-500 hover:bg-mahakan-green-50/30">
          <Upload className="size-6 text-neutral-500" aria-hidden />
          <span className="text-sm font-medium text-neutral-900">
            {filename ? filename : "Klik untuk pilih file CSV"}
          </span>
          {csvText ? (
            <span className="text-[11px] text-mahakan-green-700">
              ✓ {csvText.split(/\r?\n/).length - 1} baris ter-load
            </span>
          ) : (
            <span className="text-[11px] text-neutral-500">
              Format: .csv (UTF-8). Header di baris pertama.
            </span>
          )}
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
        </label>
      </div>
    </div>
  );
}

function Step2({
  headers,
  mapping,
  setMapping,
  orderNoCol,
  setOrderNoCol,
  customerCol,
  setCustomerCol,
  notesCol,
  setNotesCol,
  parseResult,
}: {
  headers: string[];
  mapping: Partial<CsvColumnMapping>;
  setMapping: (m: Partial<CsvColumnMapping>) => void;
  orderNoCol: string;
  setOrderNoCol: (v: string) => void;
  customerCol: string;
  setCustomerCol: (v: string) => void;
  notesCol: string;
  setNotesCol: (v: string) => void;
  parseResult: ParseCsvResult | null;
}) {
  const headerOpts = headers.filter((h) => h).map((h) => ({ value: h, label: h }));
  const optionalHeaderOpts = [{ value: "__none__", label: "— Tidak ada —" }, ...headerOpts];
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Select
          label="Kolom Tanggal *"
          placeholder="— Pilih kolom —"
          options={headerOpts}
          value={(mapping.dateColumn as string) || undefined}
          onValueChange={(v) => setMapping({ ...mapping, dateColumn: v })}
        />
        <Select
          label="Kolom Gross *"
          placeholder="— Pilih kolom —"
          options={headerOpts}
          value={(mapping.grossColumn as string) || undefined}
          onValueChange={(v) => setMapping({ ...mapping, grossColumn: v })}
        />
        <Select
          label="Kolom Fee (opsional)"
          options={optionalHeaderOpts}
          value={(mapping.feeColumn as string) || "__none__"}
          onValueChange={(v) =>
            setMapping({
              ...mapping,
              feeColumn: v === "__none__" ? undefined : v,
            })
          }
        />
        <Select
          label="Kolom Net (opsional)"
          options={optionalHeaderOpts}
          value={(mapping.netColumn as string) || "__none__"}
          onValueChange={(v) =>
            setMapping({
              ...mapping,
              netColumn: v === "__none__" ? undefined : v,
            })
          }
        />
        <Select
          label="Kolom No Order (opsional)"
          options={optionalHeaderOpts}
          value={orderNoCol || "__none__"}
          onValueChange={(v) => setOrderNoCol(v === "__none__" ? "" : v)}
        />
        <Select
          label="Kolom Customer (opsional)"
          options={optionalHeaderOpts}
          value={customerCol || "__none__"}
          onValueChange={(v) => setCustomerCol(v === "__none__" ? "" : v)}
        />
        <Select
          label="Kolom Catatan (opsional)"
          options={optionalHeaderOpts}
          value={notesCol || "__none__"}
          onValueChange={(v) => setNotesCol(v === "__none__" ? "" : v)}
        />
      </div>

      <Card className="p-3">
        <p className="text-xs font-semibold text-neutral-900">
          Preview Parsing
        </p>
        {!parseResult ? (
          <p className="mt-2 text-xs text-neutral-500">
            Set kolom Tanggal + Gross untuk preview.
          </p>
        ) : (
          <>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="success">
                ✓ {parseResult.rows.length} row valid
              </Badge>
              {parseResult.errors.length > 0 ? (
                <Badge variant="warning">
                  ⚠ {parseResult.errors.length} row error
                </Badge>
              ) : null}
            </div>
            {parseResult.errors.length > 0 ? (
              <div className="mt-2 max-h-24 overflow-y-auto rounded border border-warning-200 bg-warning-50/40 p-2 text-[11px] text-warning-700">
                {parseResult.errors.slice(0, 5).map((e, i) => (
                  <div key={i}>
                    Row {e.rowIndex}: {e.message}
                  </div>
                ))}
                {parseResult.errors.length > 5 ? (
                  <div className="text-neutral-500">
                    …{parseResult.errors.length - 5} error lainnya
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="mt-2 max-h-40 overflow-auto rounded border border-neutral-200">
              <table className="w-full text-xs">
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="px-2 py-1 text-left">Tanggal</th>
                    <th className="px-2 py-1 text-right">Gross</th>
                    <th className="px-2 py-1 text-right">Fee</th>
                    <th className="px-2 py-1 text-right">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {parseResult.rows.slice(0, 5).map((r, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1">{r.date}</td>
                      <td className="px-2 py-1 text-right font-mono">
                        {formatRupiah(r.grossAmount)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">
                        {r.feeAmount > 0 ? formatRupiah(r.feeAmount) : "—"}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">
                        {formatRupiah(r.netAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function Step3({
  aggMode,
  setAggMode,
  referenceNo,
  setReferenceNo,
  notes,
  setNotes,
  groupedItems,
}: {
  aggMode: AggregationMode;
  setAggMode: (m: AggregationMode) => void;
  referenceNo: string;
  setReferenceNo: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  groupedItems: Array<{
    periodFrom: string;
    periodTo: string;
    gross: number;
    fee: number;
    net: number;
    items: AggregatorLineItem[];
  }>;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-neutral-900">
          Mode Aggregasi
        </label>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setAggMode("daily")}
            className={cn(
              "rounded-md border px-3 py-2 text-left text-sm transition-colors",
              aggMode === "daily"
                ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                : "border-neutral-300 bg-white hover:bg-neutral-50",
            )}
          >
            <div className="font-semibold">Per Hari</div>
            <div className="mt-0.5 text-[11px] text-neutral-600">
              1 settlement per tanggal. N row → N settlement. Best untuk
              tracking harian + reconciliation per shift.
            </div>
          </button>
          <button
            type="button"
            onClick={() => setAggMode("single")}
            className={cn(
              "rounded-md border px-3 py-2 text-left text-sm transition-colors",
              aggMode === "single"
                ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                : "border-neutral-300 bg-white hover:bg-neutral-50",
            )}
          >
            <div className="font-semibold">Total Periode</div>
            <div className="mt-0.5 text-[11px] text-neutral-600">
              1 settlement total seluruh range. Simple — cocok untuk monthly
              statement aggregator.
            </div>
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Input
          label="Reference No (opsional)"
          value={referenceNo}
          onChange={(e) => setReferenceNo(e.target.value)}
          placeholder="mis. STMT-202605"
          maxLength={64}
        />
        <Input
          label="Catatan (opsional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="mis. Statement bulan Mei"
          maxLength={500}
        />
      </div>

      <Card className="p-3">
        <p className="text-xs font-semibold text-neutral-900">
          Preview: {groupedItems.length} settlement akan dibuat
        </p>
        <div className="mt-2 max-h-48 overflow-auto rounded border border-neutral-200">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-2 py-1 text-left">Periode</th>
                <th className="px-2 py-1 text-right">Orders</th>
                <th className="px-2 py-1 text-right">Gross</th>
                <th className="px-2 py-1 text-right">Fee</th>
                <th className="px-2 py-1 text-right">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {groupedItems.slice(0, 30).map((g, i) => (
                <tr key={i}>
                  <td className="px-2 py-1">
                    {g.periodFrom === g.periodTo
                      ? g.periodFrom
                      : `${g.periodFrom} → ${g.periodTo}`}
                  </td>
                  <td className="px-2 py-1 text-right">{g.items.length}</td>
                  <td className="px-2 py-1 text-right font-mono">
                    {formatRupiah(g.gross)}
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-danger-600">
                    {g.fee > 0 ? formatRupiah(g.fee) : "—"}
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-mahakan-green-700">
                    {formatRupiah(g.net)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-neutral-50 text-xs font-semibold">
              <tr>
                <td className="px-2 py-1 text-right">Total</td>
                <td className="px-2 py-1 text-right">
                  {groupedItems.reduce((s, g) => s + g.items.length, 0)}
                </td>
                <td className="px-2 py-1 text-right font-mono">
                  {formatRupiah(groupedItems.reduce((s, g) => s + g.gross, 0))}
                </td>
                <td className="px-2 py-1 text-right font-mono text-danger-600">
                  {formatRupiah(groupedItems.reduce((s, g) => s + g.fee, 0))}
                </td>
                <td className="px-2 py-1 text-right font-mono text-mahakan-green-700">
                  {formatRupiah(groupedItems.reduce((s, g) => s + g.net, 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Step4({
  channel,
  groupedItems,
  submitting,
  submitResult,
}: {
  channel: Channel;
  groupedItems: Array<{
    periodFrom: string;
    periodTo: string;
    gross: number;
    fee: number;
    net: number;
    items: AggregatorLineItem[];
  }>;
  submitting: boolean;
  submitResult: { ok: number; fail: number; errors: string[] } | null;
}) {
  if (submitting) {
    return (
      <div className="flex flex-col items-center gap-2 py-8">
        <Loader2 className="size-6 animate-spin text-mahakan-green-700" />
        <p className="text-sm text-neutral-700">
          Sedang import {groupedItems.length} settlement…
        </p>
      </div>
    );
  }
  if (submitResult) {
    const allOk = submitResult.fail === 0;
    return (
      <Card
        className={cn(
          "p-4",
          allOk
            ? "border-success-300 bg-success-50/40"
            : "border-warning-300 bg-warning-50/40",
        )}
      >
        <div className="flex items-start gap-3">
          {allOk ? (
            <CheckCircle2 className="size-5 text-success-700" aria-hidden />
          ) : (
            <AlertTriangle className="size-5 text-warning-700" aria-hidden />
          )}
          <div className="flex-1">
            <h3 className="text-sm font-semibold">
              {allOk
                ? `Berhasil import ${submitResult.ok} settlement`
                : `Sebagian: ${submitResult.ok} sukses, ${submitResult.fail} gagal`}
            </h3>
            {submitResult.errors.length > 0 ? (
              <div className="mt-2 max-h-32 overflow-y-auto rounded bg-white/60 p-2 text-[11px] text-danger-700">
                {submitResult.errors.slice(0, 10).map((e, i) => (
                  <div key={i}>• {e}</div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </Card>
    );
  }
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-neutral-900">
        Konfirmasi Import
      </h3>
      <p className="mt-1 text-xs text-neutral-700">
        Akan create <strong>{groupedItems.length}</strong> settlement untuk
        channel <strong>{channel}</strong>. Tiap settlement otomatis
        ter-post ke jurnal sesuai mapping channel.
      </p>
      <div className="mt-3 rounded border border-warning-200 bg-warning-50/40 p-2 text-[11px] text-warning-700">
        <AlertTriangle className="mr-1 inline size-3" />
        <strong>Tidak bisa di-undo bulk</strong> — kalau salah, harus delete
        satu-satu lewat list. Pastikan preview di step sebelumnya sudah benar.
      </div>
    </Card>
  );
}

/* ---------------------------- Helpers ------------------------------------ */

function buildLineItem(
  row: ParsedSettlementRow,
  csvText: string,
  cols: { orderNoCol: string; customerCol: string; notesCol: string },
): AggregatorLineItem {
  const item: AggregatorLineItem = {
    date: row.date,
    gross: row.grossAmount,
    fee: row.feeAmount,
    net: row.netAmount,
    rawLine: row.sourceRowIndex,
  };
  // Try to extract optional fields from source CSV using header columns
  if (cols.orderNoCol || cols.customerCol || cols.notesCol) {
    const lines = csvText.split(/\r?\n/);
    const headerLine = lines[0] ?? "";
    const headers = headerLine
      .split(/[,;\t]/)
      .map((c) => c.trim().replace(/^"|"$/g, ""));
    const rowLine = lines[row.sourceRowIndex - 1] ?? "";
    const cells = rowLine
      .split(/[,;\t]/)
      .map((c) => c.trim().replace(/^"|"$/g, ""));
    const idx = (h: string) =>
      headers.findIndex((x) => x.toLowerCase() === h.toLowerCase());
    if (cols.orderNoCol) {
      const i = idx(cols.orderNoCol);
      if (i >= 0 && cells[i]) item.orderNo = cells[i];
    }
    if (cols.customerCol) {
      const i = idx(cols.customerCol);
      if (i >= 0 && cells[i]) item.customer = cells[i];
    }
    if (cols.notesCol) {
      const i = idx(cols.notesCol);
      if (i >= 0 && cells[i]) item.notes = cells[i];
    }
  }
  return item;
}
