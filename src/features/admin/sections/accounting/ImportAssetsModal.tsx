"use client";

import { useState } from "react";
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  Download,
  Upload,
} from "lucide-react";
import { Badge, Button, Modal, Skeleton, toast } from "@/components/ui";
import { bulkImportFixedAssets } from "@/features/accounting/fixed-assets-actions";
import {
  fixedAssetCsvTemplate,
  parseFixedAssetCsv,
  type FixedAssetImportPreview,
} from "./fixed-asset-csv";
import { downloadCsv } from "./accounting-csv";
import { formatRupiah } from "@/lib/money";

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export function ImportAssetsModal({ open, onClose, onImported }: Props) {
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<FixedAssetImportPreview | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{
    inserted: number;
    capitalized: number;
    errorCount: number;
  } | null>(null);

  function reset() {
    setCsvText("");
    setPreview(null);
    setSubmitting(false);
    setDone(null);
  }

  function handleDownloadTemplate() {
    const csv = fixedAssetCsvTemplate();
    downloadCsv("mahakan-fixed-asset-template.csv", csv);
    toast.success("Template CSV terdownload");
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    const parsed = parseFixedAssetCsv(text);
    setPreview(parsed);
    setDone(null);
  }

  async function handleSubmit() {
    if (!preview || preview.rows.length === 0) return;
    setSubmitting(true);
    const res = await bulkImportFixedAssets(
      preview.rows.map((r) => ({
        name: r.name,
        category: r.category,
        cost: r.cost,
        salvageValue: r.salvageValue,
        usefulLifeMonths: r.usefulLifeMonths,
        acquiredDate: r.acquiredDate,
        assetAccountCode: r.assetAccountCode,
        depreciationAccountCode: r.depreciationAccountCode,
        capitalize: r.capitalize,
        paymentMethod: r.paymentMethod,
        notes: r.notes,
      })),
    );
    setSubmitting(false);
    if (res.ok) {
      setDone({
        inserted: res.data.inserted,
        capitalized: res.data.capitalized,
        errorCount: res.data.errors.length,
      });
      if (res.data.errors.length > 0) {
        toast.error(
          `${res.data.inserted} sukses, ${res.data.errors.length} error — lihat detail`,
        );
      } else {
        toast.success(
          `${res.data.inserted} aset di-import, ${res.data.capitalized} capitalized`,
        );
      }
    } else {
      toast.error(res.error.message);
    }
  }

  function handleDone() {
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
      title="Import Aset Tetap dari CSV"
      description="Upload CSV multi-baris. Owner format spreadsheet, save as CSV (UTF-8), upload disini. Validasi per-baris, error tidak block sukses."
      size="3xl"
      footer={
        done ? (
          <div className="flex w-full justify-end gap-2">
            <Button onClick={handleDone}>Selesai</Button>
          </div>
        ) : (
          <div className="flex w-full items-center justify-between gap-3">
            <div className="text-sm text-neutral-500">
              {preview ? (
                <>
                  <strong>{preview.rows.length}</strong> baris valid,{" "}
                  <strong>{preview.errors.length}</strong> error
                </>
              ) : (
                "Upload CSV untuk preview"
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  reset();
                  onClose();
                }}
                disabled={submitting}
              >
                Batal
              </Button>
              <Button
                onClick={handleSubmit}
                loading={submitting}
                disabled={
                  submitting || !preview || preview.rows.length === 0
                }
              >
                <Upload className="size-4" /> Import {preview?.rows.length ?? 0} Baris
              </Button>
            </div>
          </div>
        )
      }
    >
      {done ? (
        <div className="space-y-3 py-4 text-center">
          <CheckCircle2 className="mx-auto size-12 text-success-500" />
          <h3 className="text-lg font-semibold">Import Selesai</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-success-500/50 bg-success-100/40 p-3">
              <div className="text-xs text-neutral-500">Tersimpan</div>
              <div className="font-mono text-2xl font-bold text-success-500">
                {done.inserted}
              </div>
            </div>
            <div className="rounded-md border border-mahakan-green-300 bg-mahakan-green-50 p-3">
              <div className="text-xs text-neutral-500">Capitalized</div>
              <div className="font-mono text-2xl font-bold text-mahakan-green-700">
                {done.capitalized}
              </div>
            </div>
            <div
              className={
                done.errorCount > 0
                  ? "rounded-md border border-warning-500/50 bg-warning-100/40 p-3"
                  : "rounded-md border border-neutral-200 p-3"
              }
            >
              <div className="text-xs text-neutral-500">Error</div>
              <div
                className={`font-mono text-2xl font-bold ${
                  done.errorCount > 0
                    ? "text-warning-500"
                    : "text-neutral-400"
                }`}
              >
                {done.errorCount}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Step 1: Download template */}
          <div className="rounded-md border border-mahakan-green-100 bg-mahakan-green-50/40 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Boxes className="size-4 text-mahakan-green-700" />
              <strong className="text-sm">Step 1: Download template</strong>
            </div>
            <p className="mb-2 text-xs text-neutral-600">
              CSV header: nama, kategori, cost, salvage_value,
              useful_life_months, acquired_date (YYYY-MM-DD), asset_account_code
              (1201/1202/1203/1204), depreciation_account_code
              (6501/6502/6503/6504), capitalize (true/false),
              payment_method (cash/transfer_bca/_bri/_other), notes
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadTemplate}
            >
              <Download className="size-4" /> Download Template
            </Button>
          </div>

          {/* Step 2: Upload */}
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">
              Step 2: Upload CSV
            </label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="block w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-mahakan-green-700 file:px-3 file:py-1 file:text-white hover:file:bg-mahakan-green-800"
            />
          </div>

          {/* Step 3: Preview */}
          {preview ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <strong className="text-sm">
                  Step 3: Preview ({preview.totalParsed} baris parsed)
                </strong>
                <Badge variant="success">{preview.rows.length} valid</Badge>
                {preview.errors.length > 0 ? (
                  <Badge variant="danger">{preview.errors.length} error</Badge>
                ) : null}
              </div>

              {preview.errors.length > 0 ? (
                <div className="rounded-md border border-danger-500/50 bg-danger-100/40 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-sm font-medium text-danger-500">
                    <AlertCircle className="size-4" /> Error per Baris
                  </div>
                  <ul className="ml-5 list-disc text-xs text-neutral-700">
                    {preview.errors.slice(0, 20).map((e, idx) => (
                      <li key={idx}>
                        Baris {e.rowNumber} · <strong>{e.field}</strong>:{" "}
                        {e.message}
                      </li>
                    ))}
                    {preview.errors.length > 20 ? (
                      <li>
                        ...dan {preview.errors.length - 20} error lain. Fix
                        CSV + upload ulang.
                      </li>
                    ) : null}
                  </ul>
                </div>
              ) : null}

              {preview.rows.length > 0 ? (
                <div className="overflow-hidden rounded-md border border-neutral-200">
                  <table className="min-w-full text-xs">
                    <thead className="bg-neutral-50">
                      <tr>
                        <th className="px-2 py-1.5 text-left">Nama</th>
                        <th className="px-2 py-1.5 text-right">Cost</th>
                        <th className="px-2 py-1.5 text-center">Life</th>
                        <th className="px-2 py-1.5 text-center">Akun</th>
                        <th className="px-2 py-1.5 text-center">Cap</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {preview.rows.slice(0, 30).map((r) => (
                        <tr key={r.rowNumber}>
                          <td className="px-2 py-1">{r.name}</td>
                          <td className="px-2 py-1 text-right font-mono">
                            {formatRupiah(r.cost)}
                          </td>
                          <td className="px-2 py-1 text-center">
                            {r.usefulLifeMonths}b
                          </td>
                          <td className="px-2 py-1 text-center font-mono">
                            {r.assetAccountCode}
                          </td>
                          <td className="px-2 py-1 text-center">
                            {r.capitalize ? "✓" : "—"}
                          </td>
                        </tr>
                      ))}
                      {preview.rows.length > 30 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-2 py-2 text-center text-neutral-500"
                          >
                            ...dan {preview.rows.length - 30} baris lain
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
