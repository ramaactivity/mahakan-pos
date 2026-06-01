"use client";

import { useCallback, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  PlusCircle,
  RefreshCw,
  Upload,
} from "lucide-react";
import * as XLSX from "xlsx";
import { Button, Modal, toast } from "@/components/ui";
import {
  applyKelolaBahanImport,
  previewKelolaBahanImport,
  type ImportPreview,
} from "@/features/inventory/template-import";
import { isOk } from "@/features/inventory";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
}

interface PreviewState {
  filename: string;
  aoa: unknown[][];
  data: ImportPreview;
}

/** Baca file (xlsx/csv) → array-of-arrays tab "Bahan" (atau sheet pertama). */
async function fileToAoa(file: File): Promise<unknown[][]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName =
    wb.SheetNames.find((n) => n.toLowerCase() === "bahan") ?? wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false });
}

export function KelolaBahanImportModal({ open, onClose, onApplied }: Props) {
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setParsing(false);
    setApplying(false);
    setPreview(null);
    setGlobalError(null);
  }, []);

  const onCloseClick = useCallback(() => {
    if (applying) return;
    reset();
    onClose();
  }, [applying, onClose, reset]);

  async function handleFile(file: File) {
    if (file.size > 8_000_000) {
      setGlobalError("File terlalu besar (>8MB).");
      return;
    }
    setParsing(true);
    setGlobalError(null);
    setPreview(null);
    try {
      const aoa = await fileToAoa(file);
      const res = await previewKelolaBahanImport(aoa);
      if (!isOk(res)) {
        setGlobalError(res.error.message);
        setParsing(false);
        return;
      }
      setPreview({ filename: file.name, aoa, data: res.data });
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : "Gagal baca file");
    } finally {
      setParsing(false);
    }
  }

  async function handleApply() {
    if (!preview) return;
    setApplying(true);
    setGlobalError(null);
    try {
      const res = await applyKelolaBahanImport(preview.aoa);
      if (!isOk(res)) {
        setGlobalError(res.error.message);
        setApplying(false);
        return;
      }
      const d = res.data;
      if (d.failed > 0) {
        toast.error(
          `Selesai dengan ${d.failed} gagal. ${d.applied} berhasil (${d.created} baru, ${d.updated} update).`,
        );
        setGlobalError(
          "Beberapa baris gagal:\n" +
            d.errors.map((e) => `• ${e.name}: ${e.message}`).join("\n"),
        );
        setApplying(false);
        onApplied();
        return;
      }
      toast.success(
        `Import sukses: ${d.created} baru + ${d.updated} update.`,
      );
      reset();
      onApplied();
      onClose();
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : "Gagal apply");
    } finally {
      setApplying(false);
    }
  }

  const summary = preview?.data.summary;
  const hasErrors = (summary?.error ?? 0) > 0;
  const hasChanges = (summary?.create ?? 0) + (summary?.update ?? 0) > 0;
  // Tampilkan baris error + berubah; sembunyikan unchanged (kurangi noise).
  const shownRows =
    preview?.data.rows.filter((r) => r.status !== "unchanged") ?? [];

  return (
    <Modal
      open={open}
      onClose={onCloseClick}
      title="Import Excel — Kelola Bahan"
      description={
        preview
          ? `${preview.filename} · ${summary?.total ?? 0} baris`
          : "Upload file template (.xlsx / .csv) yang sudah diedit."
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onCloseClick} disabled={applying}>
            Tutup
          </Button>
          {preview && !hasErrors && hasChanges ? (
            <Button onClick={handleApply} loading={applying} disabled={applying}>
              Terapkan {summary!.create + summary!.update} perubahan
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md border border-info-300/50 bg-info-50 p-3 text-xs text-info-700">
          <strong>Cara kerja:</strong>
          <ul className="ml-4 mt-1 list-disc space-y-0.5">
            <li>Pencocokan via <strong>Nama Bahan</strong> (huruf besar/kecil diabaikan).</li>
            <li>Nama belum ada = <strong>bahan baru dibuat</strong>. Nama cocok = di-update.</li>
            <li>Hanya baris yang <strong>berubah</strong> yang ditulis (yang sama dilewati).</li>
            <li>Stok TIDAK diubah dari sini (wajib via Opname). Baris yang dihapus dari file tidak menghapus bahan.</li>
          </ul>
        </div>

        {!preview ? (
          <label
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-8 text-sm transition-colors",
              parsing
                ? "border-neutral-300 bg-neutral-50"
                : "border-mahakan-green-300 bg-mahakan-green-50/30 hover:bg-mahakan-green-50",
            )}
          >
            <input
              type="file"
              accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              disabled={parsing}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = "";
              }}
            />
            {parsing ? (
              <>
                <Loader2 className="size-8 animate-spin text-mahakan-green-700" />
                <span className="text-mahakan-green-900">Memproses file…</span>
              </>
            ) : (
              <>
                <Upload className="size-8 text-mahakan-green-700" />
                <span className="font-medium text-mahakan-green-900">
                  Klik untuk pilih file (.xlsx / .csv)
                </span>
                <span className="text-xs text-neutral-600">
                  Pakai file template Kelola Bahan yang sudah diedit
                </span>
              </>
            )}
          </label>
        ) : null}

        {globalError ? (
          <div className="flex items-start gap-2 rounded-md border border-danger-300 bg-danger-50 p-3 text-sm text-danger-700">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span className="whitespace-pre-wrap">{globalError}</span>
          </div>
        ) : null}

        {preview ? (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-2">
              <SummaryCard label="Baru" count={summary!.create} tone="success" />
              <SummaryCard label="Update" count={summary!.update} tone="info" />
              <SummaryCard label="Sama" count={summary!.unchanged} tone="neutral" />
              <SummaryCard label="Error" count={summary!.error} tone="danger" />
            </div>

            {hasErrors ? (
              <div className="rounded-md border border-danger-300 bg-danger-50 p-3 text-sm text-danger-700">
                <strong>Ada {summary!.error} baris error.</strong> Perbaiki di
                Excel (lihat detail di bawah), lalu upload ulang. Tombol Terapkan
                muncul setelah semua error beres.
              </div>
            ) : null}

            {!hasErrors && !hasChanges ? (
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
                Tidak ada perubahan terdeteksi — semua baris sama dengan data
                sekarang.
              </div>
            ) : null}

            {shownRows.length > 0 ? (
              <div className="max-h-80 overflow-y-auto rounded-md border border-neutral-200 divide-y divide-neutral-100">
                {shownRows.map((r) => (
                  <RowItem
                    key={r.rowNum}
                    status={r.status}
                    name={r.name}
                    message={r.message}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function SummaryCard({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "success" | "info" | "neutral" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "border-success-300 bg-success-50 text-success-700"
      : tone === "info"
        ? "border-mahakan-green-300 bg-mahakan-green-50 text-mahakan-green-900"
        : tone === "danger"
          ? "border-danger-300 bg-danger-50 text-danger-700"
          : "border-neutral-300 bg-neutral-50 text-neutral-700";
  return (
    <div className={cn("rounded-md border p-2 text-center", toneClass)}>
      <div className="text-xl font-bold">{count}</div>
      <div className="text-[10px] uppercase tracking-wide">{label}</div>
    </div>
  );
}

function RowItem({
  status,
  name,
  message,
}: {
  status: "create" | "update" | "unchanged" | "error";
  name: string;
  message?: string;
}) {
  const icon =
    status === "error" ? (
      <AlertCircle className="size-4 text-danger-500" />
    ) : status === "create" ? (
      <PlusCircle className="size-4 text-success-500" />
    ) : status === "update" ? (
      <RefreshCw className="size-4 text-mahakan-green-700" />
    ) : (
      <CheckCircle2 className="size-4 text-neutral-400" />
    );
  return (
    <div className="flex items-start gap-2 px-3 py-2 text-sm">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <span className="font-medium text-neutral-900">{name}</span>
        {message ? (
          <span
            className={cn(
              "ml-2 text-xs",
              status === "error" ? "text-danger-600" : "text-neutral-500",
            )}
          >
            {message}
          </span>
        ) : null}
      </div>
    </div>
  );
}
