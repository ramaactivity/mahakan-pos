"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Pencil,
  Upload,
} from "lucide-react";
import {
  Button,
  DatePicker,
  Input,
  Modal,
  NumericInput,
  Select,
  Skeleton,
  toast,
} from "@/components/ui";
import { createAggregatorSettlement } from "@/features/finance/actions";
import type { AggregatorChannel } from "@/features/finance/types";
import {
  aggregateDaily,
  aggregateSinglePeriod,
  parseAggregatorCsv,
  type AggregateResult,
  type ParseCsvResult,
} from "@/features/finance/aggregator-csv-parser";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const CHANNEL_OPTIONS: Array<{ value: AggregatorChannel; label: string }> = [
  { value: "edc_bca", label: "EDC BCA" },
  { value: "qris", label: "QRIS" },
  { value: "gofood", label: "GoFood" },
  { value: "grabfood", label: "GrabFood" },
  { value: "shopeefood", label: "ShopeeFood" },
];

function todayIso(): string {
  const wibOffset = 7 * 60 * 60 * 1000;
  return new Date(Date.now() + wibOffset).toISOString().slice(0, 10);
}

type Mode = "manual" | "import";

/**
 * Sesi AE-62q — AggregatorSettlementModal dengan 2 tab:
 *  - Manual: form 1 settlement (existing behavior, pre-AE-62q)
 *  - Import CSV: upload file CSV/Excel dari aggregator app, parse,
 *    aggregate (per-day atau single period), preview, bulk submit.
 *
 * Import flow:
 *  1. User pilih channel + upload file (.csv)
 *  2. Sistem auto-detect kolom (tanggal/gross/komisi/net)
 *  3. Preview table per row + tombol "Aggregate per hari" / "Aggregate total"
 *  4. Confirm → loop createAggregatorSettlement per aggregated row
 *  5. Report sukses/gagal count + toast
 */
export function AggregatorSettlementModal({ open, onClose, onSaved }: Props) {
  const [mode, setMode] = useState<Mode>("manual");

  // Shared state
  const [channel, setChannel] = useState<AggregatorChannel>("edc_bca");
  const [submitting, setSubmitting] = useState(false);

  // Manual mode state
  const [periodFrom, setPeriodFrom] = useState<string | null>(todayIso());
  const [periodTo, setPeriodTo] = useState<string | null>(todayIso());
  const [grossAmount, setGrossAmount] = useState("");
  const [feeAmount, setFeeAmount] = useState("0");
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");

  // Import mode state
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<ParseCsvResult | null>(null);
  const [aggregationMode, setAggregationMode] = useState<"daily" | "single">(
    "daily",
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Sesi AE-62ag — `aggregated` derived dari parseResult + mode, jadi useMemo
   * (pre-fix pakai useState + useEffect → lint set-state-in-effect cascade). */
  const aggregated: AggregateResult[] = useMemo(() => {
    if (!parseResult) return [];
    if (aggregationMode === "daily") return aggregateDaily(parseResult.rows);
    const single = aggregateSinglePeriod(parseResult.rows);
    return single ? [single] : [];
  }, [parseResult, aggregationMode]);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    const t = todayIso();
    setMode("manual");
    setChannel("edc_bca");
    setPeriodFrom(t);
    setPeriodTo(t);
    setGrossAmount("");
    setFeeAmount("0");
    setReferenceNo("");
    setNotes("");
    setCsvFile(null);
    setParseResult(null);
    setAggregationMode("daily");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  async function handleFilePick(file: File) {
    setCsvFile(file);
    const text = await file.text();
    const result = parseAggregatorCsv(text);
    setParseResult(result);
    if (result.rows.length === 0) {
      toast.error(
        `Gagal parse: ${result.errors[0]?.message ?? "tidak ada baris valid"}`,
      );
    } else {
      toast.success(
        `${result.rows.length} baris parsed${result.errors.length > 0 ? ` (${result.errors.length} error)` : ""}`,
      );
    }
  }

  async function onSubmitManual() {
    if (!periodFrom || !periodTo) {
      toast.error("Periode wajib diisi");
      return;
    }
    const gross = Number(grossAmount);
    const fee = Number(feeAmount || 0);
    if (!gross || gross < 0) {
      toast.error("Gross harus diisi");
      return;
    }
    if (fee > gross) {
      toast.error("Fee tidak boleh > gross");
      return;
    }
    if (periodTo < periodFrom) {
      toast.error("Periode akhir harus >= awal");
      return;
    }
    setSubmitting(true);
    try {
      const res = await createAggregatorSettlement({
        channel,
        periodFrom,
        periodTo,
        grossAmount: gross,
        feeAmount: fee,
        referenceNo: referenceNo.trim() || null,
        notes: notes.trim() || null,
      });
      if (res.ok) {
        toast.success("Settlement aggregator dicatat");
        onSaved();
        onClose();
      } else {
        toast.error(res.error.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitImport() {
    if (aggregated.length === 0) {
      toast.error("Tidak ada data untuk di-import");
      return;
    }
    setSubmitting(true);
    let okCount = 0;
    let failCount = 0;
    const failures: string[] = [];
    try {
      for (const agg of aggregated) {
        const res = await createAggregatorSettlement({
          channel,
          periodFrom: agg.periodFrom,
          periodTo: agg.periodTo,
          grossAmount: agg.grossAmount,
          feeAmount: agg.feeAmount,
          referenceNo: csvFile?.name ?? null,
          notes: `Import CSV: ${agg.rowCount} order${agg.rowCount > 1 ? "s" : ""} dari ${csvFile?.name ?? "file"}`,
        });
        if (res.ok) {
          okCount++;
        } else {
          failCount++;
          failures.push(`${agg.periodFrom}: ${res.error.message}`);
        }
      }
      if (okCount > 0) {
        toast.success(
          `${okCount} settlement berhasil di-import${failCount > 0 ? ` (${failCount} gagal)` : ""}`,
        );
        onSaved();
      }
      if (failCount > 0) {
        toast.error(
          `${failCount} gagal: ${failures.slice(0, 3).join("; ")}${failures.length > 3 ? "; ..." : ""}`,
        );
      }
      if (okCount > 0) {
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      title="Catat Settlement Aggregator"
      description={
        mode === "manual"
          ? "Input 1 settlement secara manual."
          : "Import bulk dari CSV/Excel export aggregator app."
      }
      size="xl"
    >
      {/* Tab navigation */}
      <div className="mb-4 flex gap-1 border-b border-neutral-200">
        <TabButton
          active={mode === "manual"}
          onClick={() => setMode("manual")}
          icon={<Pencil className="size-4" aria-hidden />}
        >
          Manual Input
        </TabButton>
        <TabButton
          active={mode === "import"}
          onClick={() => setMode("import")}
          icon={<FileSpreadsheet className="size-4" aria-hidden />}
        >
          Import CSV
        </TabButton>
      </div>

      {mode === "manual" ? (
        <div className="space-y-4">
          <Select
            label="Channel"
            value={channel}
            onValueChange={(v) => setChannel(v as AggregatorChannel)}
            options={CHANNEL_OPTIONS}
          />
          <div className="grid grid-cols-2 gap-3">
            <DatePicker
              label="Periode (Dari)"
              value={periodFrom}
              onChange={setPeriodFrom}
              required
            />
            <DatePicker
              label="Periode (Sampai)"
              value={periodTo}
              onChange={setPeriodTo}
              required
            />
          </div>
          <NumericInput
            label="Gross (sebelum fee)"
            value={grossAmount}
            onChange={setGrossAmount}
            prefix="Rp"
            formatThousands
            required
          />
          <NumericInput
            label="Fee / MDR (opsional)"
            value={feeAmount}
            onChange={setFeeAmount}
            prefix="Rp"
            formatThousands
            hint="Biarkan 0 kalau Mahakan tidak kena potongan"
          />
          <Input
            label="No. Referensi"
            placeholder="Statement bank / portal aggregator"
            value={referenceNo}
            onChange={(e) => setReferenceNo(e.target.value)}
          />
          <Input
            label="Catatan"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              Batal
            </Button>
            <Button onClick={onSubmitManual} disabled={submitting}>
              {submitting ? "Menyimpan…" : "Simpan"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Select
            label="Channel"
            value={channel}
            onValueChange={(v) => setChannel(v as AggregatorChannel)}
            options={CHANNEL_OPTIONS}
          />

          {/* File upload */}
          {!csvFile ? (
            <div className="rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 p-6 text-center">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,.txt"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFilePick(f);
                }}
              />
              <Upload className="mx-auto size-8 text-neutral-400" aria-hidden />
              <p className="mt-2 text-sm font-medium text-neutral-900">
                Upload file CSV dari aggregator app
              </p>
              <p className="text-xs text-neutral-500">
                GoFood / GrabFood / ShopeeFood — sistem auto-detect kolom
                Tanggal + Gross + Komisi.
              </p>
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="mt-3"
              >
                <Upload className="size-4" /> Pilih File CSV
              </Button>
            </div>
          ) : (
            <div className="rounded-md border border-neutral-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-900">
                    {csvFile.name}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {(csvFile.size / 1024).toFixed(1)} KB ·{" "}
                    {parseResult ? `${parseResult.rows.length} baris parsed` : "Memproses…"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCsvFile(null);
                                    setParseResult(null);
                  }}
                >
                  Hapus
                </Button>
              </div>
            </div>
          )}

          {parseResult ? (
            <>
              {/* Parse summary */}
              {parseResult.detectedHeaders ? (
                <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2 text-xs">
                  <p className="font-medium text-neutral-700">
                    Header terdeteksi:
                  </p>
                  <p className="font-mono text-[10px] text-neutral-600">
                    {parseResult.detectedHeaders.join(" | ")}
                  </p>
                </div>
              ) : null}

              {parseResult.errors.length > 0 ? (
                <div className="rounded-md border border-warning-300 bg-warning-50 p-2 text-xs text-warning-700">
                  <p className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>
                      <strong>{parseResult.errors.length} baris di-skip:</strong>
                      <ul className="ml-4 mt-1 list-disc">
                        {parseResult.errors.slice(0, 3).map((e, i) => (
                          <li key={i}>
                            Baris {e.rowIndex}: {e.message}
                          </li>
                        ))}
                        {parseResult.errors.length > 3 ? (
                          <li>
                            ... dan {parseResult.errors.length - 3} lainnya
                          </li>
                        ) : null}
                      </ul>
                    </span>
                  </p>
                </div>
              ) : null}

              {/* Aggregation mode */}
              {parseResult.rows.length > 0 ? (
                <>
                  <div className="flex items-center gap-2 rounded-md border border-neutral-200 bg-white p-2">
                    <span className="text-xs font-medium text-neutral-700">
                      Mode Aggregate:
                    </span>
                    <button
                      type="button"
                      onClick={() => setAggregationMode("daily")}
                      className={cn(
                        "rounded-md px-2 py-1 text-xs",
                        aggregationMode === "daily"
                          ? "bg-mahakan-green-700 text-white"
                          : "border border-neutral-300 text-neutral-700 hover:bg-neutral-100",
                      )}
                    >
                      Per Hari
                    </button>
                    <button
                      type="button"
                      onClick={() => setAggregationMode("single")}
                      className={cn(
                        "rounded-md px-2 py-1 text-xs",
                        aggregationMode === "single"
                          ? "bg-mahakan-green-700 text-white"
                          : "border border-neutral-300 text-neutral-700 hover:bg-neutral-100",
                      )}
                    >
                      Total (1 row)
                    </button>
                    <span className="ml-auto text-[10px] text-neutral-500">
                      Akan dibuat <strong>{aggregated.length}</strong> settlement
                    </span>
                  </div>

                  {/* Preview table */}
                  <div className="max-h-[280px] overflow-y-auto rounded-md border border-neutral-200">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-neutral-50 text-neutral-600">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">
                            Periode
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            Gross
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            Fee
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            Net
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            Trx
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {aggregated.map((a, i) => (
                          <tr key={i} className="hover:bg-neutral-50">
                            <td className="px-3 py-1.5 text-neutral-900">
                              {a.periodFrom === a.periodTo
                                ? a.periodFrom
                                : `${a.periodFrom} → ${a.periodTo}`}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono">
                              {formatRupiah(a.grossAmount)}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono text-neutral-500">
                              {formatRupiah(a.feeAmount)}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono font-semibold">
                              {formatRupiah(a.netAmount)}
                            </td>
                            <td className="px-3 py-1.5 text-right text-neutral-500">
                              {a.rowCount}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-neutral-50 text-xs font-semibold text-neutral-700">
                        <tr>
                          <td className="px-3 py-2">Total</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatRupiah(
                              aggregated.reduce(
                                (s, a) => s + a.grossAmount,
                                0,
                              ),
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatRupiah(
                              aggregated.reduce((s, a) => s + a.feeAmount, 0),
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatRupiah(
                              aggregated.reduce((s, a) => s + a.netAmount, 0),
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {aggregated.reduce((s, a) => s + a.rowCount, 0)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              ) : null}
            </>
          ) : csvFile ? (
            <Skeleton className="h-32 w-full" />
          ) : null}

          <div className="rounded-md border border-warning-300 bg-warning-100 p-2 text-xs text-warning-700">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                <strong>Perhatian:</strong> bulk import akan create N
                settlement rows + N journal entries. Tidak bisa di-undo
                bulk — kalau salah, harus delete satu-satu lewat list.
                Cek preview baik-baik dulu.
              </span>
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              Batal
            </Button>
            <Button
              onClick={onSubmitImport}
              disabled={submitting || aggregated.length === 0}
            >
              {submitting ? (
                "Importing…"
              ) : (
                <>
                  <CheckCircle2 className="size-4" /> Import{" "}
                  {aggregated.length} Settlement
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors",
        active
          ? "text-mahakan-green-900"
          : "text-neutral-600 hover:text-neutral-900",
      )}
    >
      {icon}
      {children}
      {active ? (
        <span className="absolute inset-x-0 -bottom-px h-0.5 bg-mahakan-green-700" />
      ) : null}
    </button>
  );
}
