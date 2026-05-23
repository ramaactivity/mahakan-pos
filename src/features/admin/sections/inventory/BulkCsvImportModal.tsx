"use client";

import { useCallback, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react";
import { Button, Modal, toast } from "@/components/ui";
import {
  applyIngredientsBulkUpdate,
  previewIngredientsBulkUpdate,
} from "@/features/inventory/csv-actions";
import { isOk } from "@/features/inventory";
import type { RowDiff } from "@/features/inventory/csv-io";
import { cn } from "@/lib/utils";

interface BulkCsvImportModalProps {
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
}

interface PreviewState {
  filename: string;
  csvText: string;
  rows: RowDiff[];
  summary: {
    create: number;
    update: number;
    unchanged: number;
    error: number;
    total: number;
  };
}

export function BulkCsvImportModal({
  open,
  onClose,
  onApplied,
}: BulkCsvImportModalProps) {
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
    if (file.size > 5_000_000) {
      setGlobalError("File terlalu besar (>5MB). Pakai filter atau split.");
      return;
    }
    setParsing(true);
    setGlobalError(null);
    setPreview(null);
    try {
      const text = await file.text();
      const res = await previewIngredientsBulkUpdate(text);
      if (!isOk(res)) {
        setGlobalError(res.error.message);
        setParsing(false);
        return;
      }
      setPreview({
        filename: file.name,
        csvText: text,
        rows: res.data.rows,
        summary: res.data.summary,
      });
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
      const res = await applyIngredientsBulkUpdate(preview.csvText);
      if (!isOk(res)) {
        setGlobalError(res.error.message);
        setApplying(false);
        return;
      }
      const d = res.data;
      toast.success(
        `Bulk update sukses: ${d.createdCount} baru + ${d.updatedCount} update` +
          (d.cascadedPreparationCount > 0
            ? ` (cascade ke ${d.cascadedPreparationCount} preparation)`
            : ""),
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

  const hasErrors = (preview?.summary.error ?? 0) > 0;
  const hasChanges =
    (preview?.summary.create ?? 0) + (preview?.summary.update ?? 0) > 0;

  return (
    <Modal
      open={open}
      onClose={onCloseClick}
      title="Upload CSV — Bulk Update Bahan"
      description={
        preview
          ? `${preview.filename} · ${preview.summary.total} baris`
          : "Upload CSV hasil edit dari Google Sheets / Excel."
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onCloseClick} disabled={applying}>
            Tutup
          </Button>
          {preview && !hasErrors && hasChanges ? (
            <Button
              onClick={handleApply}
              loading={applying}
              disabled={applying}
            >
              Apply Changes
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        {/* Safety notice */}
        <div className="rounded-md border border-warning-300/50 bg-warning-50 p-3 text-xs text-warning-700">
          <strong>⚠️ Safety rules:</strong>
          <ul className="ml-4 mt-1 list-disc space-y-0.5">
            <li>
              <code>current_stock</code> di CSV{" "}
              <strong>READ-ONLY</strong> — di-ignore. Stock changes wajib via
              Opname.
            </li>
            <li>
              <code>id</code> kosong = create bahan baru. <code>id</code> match
              = update existing.
            </li>
            <li>Row yang dihapus dari CSV TIDAK auto-delete bahan.</li>
            <li>Atomic: semua row sukses, atau semua rollback.</li>
          </ul>
        </div>

        {/* Upload zone (visible when no preview) */}
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
              accept=".csv,text/csv"
              className="hidden"
              disabled={parsing}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = ""; // allow re-select same file
              }}
            />
            {parsing ? (
              <>
                <Loader2 className="size-8 animate-spin text-mahakan-green-700" />
                <span className="text-mahakan-green-900">
                  Memproses CSV...
                </span>
              </>
            ) : (
              <>
                <Upload className="size-8 text-mahakan-green-700" />
                <span className="font-medium text-mahakan-green-900">
                  Klik untuk pilih file CSV
                </span>
                <span className="text-xs text-neutral-600">
                  Max 5MB · format hasil download dari tombol Download CSV
                </span>
              </>
            )}
          </label>
        ) : null}

        {/* Global error */}
        {globalError ? (
          <div className="flex items-start gap-2 rounded-md border border-danger-300 bg-danger-50 p-3 text-sm text-danger-700">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span>{globalError}</span>
          </div>
        ) : null}

        {/* Preview summary */}
        {preview ? (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-2">
              <SummaryCard
                label="Baru"
                count={preview.summary.create}
                tone="success"
              />
              <SummaryCard
                label="Update"
                count={preview.summary.update}
                tone="info"
              />
              <SummaryCard
                label="Unchanged"
                count={preview.summary.unchanged}
                tone="neutral"
              />
              <SummaryCard
                label="Error"
                count={preview.summary.error}
                tone="danger"
              />
            </div>

            {hasErrors ? (
              <div className="rounded-md border border-danger-300 bg-danger-50 p-3 text-sm text-danger-700">
                <strong>Ada {preview.summary.error} row error.</strong> Fix
                error di CSV (lihat detail bawah), lalu re-upload. Apply tidak
                bisa dilakukan kalau masih ada error.
              </div>
            ) : null}

            {!hasErrors && !hasChanges ? (
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
                Tidak ada perubahan terdeteksi. Semua row UNCHANGED.
              </div>
            ) : null}

            {/* Row details (scrollable) */}
            <div className="max-h-80 overflow-y-auto rounded-md border border-neutral-200">
              {preview.rows.map((r) => (
                <RowItem key={r.rowNumber} row={r} />
              ))}
            </div>
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
        ? "border-info-300 bg-info-50 text-info-700"
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

function RowItem({ row }: { row: RowDiff }) {
  const iconColor =
    row.action === "create"
      ? "text-success-500"
      : row.action === "update"
        ? "text-info-500"
        : row.action === "error"
          ? "text-danger-500"
          : "text-neutral-400";

  const actionLabel =
    row.action === "create"
      ? "NEW"
      : row.action === "update"
        ? "UPDATE"
        : row.action === "error"
          ? "ERROR"
          : "UNCHANGED";

  return (
    <details className="group border-b border-neutral-100 last:border-b-0">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-neutral-50">
        <CheckCircle2 className={cn("size-3.5 shrink-0", iconColor)} />
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-semibold",
            row.action === "create" && "bg-success-100 text-success-700",
            row.action === "update" && "bg-info-100 text-info-700",
            row.action === "error" && "bg-danger-100 text-danger-700",
            row.action === "unchanged" && "bg-neutral-100 text-neutral-600",
          )}
        >
          {actionLabel}
        </span>
        <span className="text-neutral-500">#{row.rowNumber}</span>
        <span className="flex-1 truncate font-medium">
          {row.parsed?.name ?? "(no name)"}
        </span>
        {row.changedFields.length > 0 ? (
          <span className="text-neutral-500">
            {row.changedFields.length} field
          </span>
        ) : null}
      </summary>
      <div className="space-y-1 bg-neutral-50/50 px-6 py-2 text-xs">
        {row.errors.length > 0 ? (
          <div className="space-y-0.5">
            {row.errors.map((e, i) => (
              <div key={i} className="text-danger-700">
                <FileSpreadsheet className="mr-1 inline size-3" />
                {e.field}: {e.message}
              </div>
            ))}
          </div>
        ) : row.action === "update" ? (
          <div className="text-neutral-700">
            Changed: {row.changedFields.join(", ")}
          </div>
        ) : row.action === "create" ? (
          <div className="text-neutral-700">
            New: {row.parsed?.section ?? "(no section)"} · Recipe{" "}
            {row.parsed?.recipeUnit}
            {row.parsed?.purchaseUnit
              ? ` · Purchase ${row.parsed.purchaseUnit} (1=${row.parsed.purchasePerRecipe ?? 1})`
              : ""}{" "}
            · Rp {row.parsed?.costPerUnit.toLocaleString("id-ID")}/recipe unit
          </div>
        ) : (
          <div className="text-neutral-500">No changes</div>
        )}
      </div>
    </details>
  );
}
