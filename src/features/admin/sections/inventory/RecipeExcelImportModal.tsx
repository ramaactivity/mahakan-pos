"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Plus,
  RefreshCcw,
  Upload,
} from "lucide-react";
import { Badge, Button, Modal, toast } from "@/components/ui";
import {
  applyRecipesImport,
  exportRecipesXlsx,
  previewRecipesImport,
  type RecipeImportPreview,
} from "@/features/inventory/xlsx-actions";
import { isOk } from "@/features/inventory";
import { cn } from "@/lib/utils";

interface RecipeExcelImportModalProps {
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
}

type Mode = "idle" | "uploading" | "preview" | "applying" | "done";

/**
 * Sesi AE-139 — Excel (xlsx) upload modal untuk Menu Recipe. Sama
 * pattern dengan PrepExcelImportModal, beda di:
 *  - menu_id/menu_name kolom (bukan prep)
 *  - variant kolom (hot/iced/blank)
 *  - tidak ada cascade
 */
export function RecipeExcelImportModal({
  open,
  onClose,
  onApplied,
}: RecipeExcelImportModalProps) {
  const [mode, setMode] = useState<Mode>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [preview, setPreview] = useState<RecipeImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setMode("idle");
    setFile(null);
    setBase64(null);
    setPreview(null);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  async function handleDownload() {
    setDownloading(true);
    const res = await exportRecipesXlsx();
    setDownloading(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    const bin = atob(res.data.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.data.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${res.data.rowCount} recipes`);
  }

  async function handleFile(picked: File | null) {
    if (!picked) return;
    setError(null);
    setMode("uploading");
    setFile(picked);
    const ab = await picked.arrayBuffer();
    const bytes = new Uint8Array(ab);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin);
    setBase64(b64);

    const res = await previewRecipesImport(b64);
    if (!isOk(res)) {
      setError(res.error.message);
      setMode("idle");
      return;
    }
    setPreview(res.data);
    setMode("preview");
  }

  async function handleApply() {
    if (!base64) return;
    setMode("applying");
    const res = await applyRecipesImport(base64);
    if (!isOk(res)) {
      setError(res.error.message);
      setMode("preview");
      return;
    }
    toast.success(
      `${res.data.createdCount} created, ${res.data.updatedCount} updated.`,
    );
    setMode("done");
    onApplied();
  }

  const blockedByErrors = (preview?.summary.error ?? 0) > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import / Export Excel — Menu Recipes"
      description="Download xlsx untuk template, edit di Excel, lalu upload kembali. Auto-mapping menu + ingredient by name."
      size="2xl"
      footer={
        mode === "preview" ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Batal
            </Button>
            <Button
              onClick={handleApply}
              disabled={blockedByErrors}
              variant={blockedByErrors ? "ghost" : "primary"}
            >
              <Plus className="size-4" aria-hidden /> Apply{" "}
              {preview ? `(${preview.summary.create + preview.summary.update})` : ""}
            </Button>
          </>
        ) : mode === "done" ? (
          <Button onClick={onClose}>Selesai</Button>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Tutup
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <div className="rounded-md border border-mahakan-green-700/20 bg-mahakan-green-50/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-mahakan-green-900">
                1. Download Template Excel
              </p>
              <p className="text-xs text-mahakan-green-900/70">
                Snapshot semua menu recipe saat ini. Edit di Excel,
                tambah/ubah ingredient, lalu upload.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDownload}
              loading={downloading}
            >
              <Download className="size-4" aria-hidden /> Download .xlsx
            </Button>
          </div>
        </div>

        {mode === "idle" || mode === "uploading" ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-neutral-900">
              2. Upload xlsx Edited
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden
              onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-neutral-300 bg-neutral-50 px-4 py-8 transition-colors hover:bg-neutral-100"
            >
              {mode === "uploading" ? (
                <Loader2 className="size-6 animate-spin text-mahakan-green-700" />
              ) : (
                <FileSpreadsheet className="size-6 text-neutral-500" aria-hidden />
              )}
              <p className="text-sm font-medium text-neutral-900">
                {mode === "uploading"
                  ? "Mem-parse..."
                  : "Klik untuk pilih file .xlsx"}
              </p>
              <p className="text-[11px] text-neutral-500">
                Max 5MB. Format: 1 row per ingredient (menu info di
                baris paling atas, ingredient tambahan = baris kosong di
                kolom menu).
              </p>
            </button>
          </div>
        ) : null}

        {mode === "preview" && preview ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-neutral-900">
                3. Preview Diff{" "}
                <span className="text-xs font-normal text-neutral-500">
                  ({file?.name})
                </span>
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setMode("idle");
                  setFile(null);
                  setBase64(null);
                  setPreview(null);
                }}
              >
                <RefreshCcw className="size-3.5" aria-hidden /> Ganti file
              </Button>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              <SummaryCard
                label="Create"
                value={preview.summary.create}
                tone="success"
              />
              <SummaryCard
                label="Update"
                value={preview.summary.update}
                tone="info"
              />
              <SummaryCard
                label="Error"
                value={preview.summary.error}
                tone="danger"
              />
              <SummaryCard
                label="Total"
                value={preview.summary.total}
                tone="neutral"
              />
            </div>
            {blockedByErrors ? (
              <div className="flex items-start gap-2 rounded-md border border-danger-500/40 bg-danger-100/40 px-3 py-2 text-xs text-danger-500">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>
                  Ada {preview.summary.error} row error. Fix dulu di Excel
                  lalu re-upload.
                </p>
              </div>
            ) : null}
            <div className="max-h-72 overflow-y-auto rounded-md border border-neutral-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-neutral-50 text-left font-medium text-neutral-700">
                  <tr>
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2">Menu</th>
                    <th className="px-3 py-2">Variant</th>
                    <th className="px-3 py-2">Lines</th>
                    <th className="px-3 py-2">Catatan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {preview.rows.map((r) => (
                    <tr
                      key={r.rowNumber}
                      className={cn(
                        "align-top",
                        r.action === "error" && "bg-danger-100/30",
                      )}
                    >
                      <td className="px-3 py-2 font-mono text-[10px] text-neutral-500">
                        {r.rowNumber}
                      </td>
                      <td className="px-3 py-2">
                        {r.action === "create" ? (
                          <Badge variant="success">Create</Badge>
                        ) : r.action === "update" ? (
                          <Badge variant="info">Update</Badge>
                        ) : (
                          <Badge variant="danger">Error</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 font-medium text-neutral-900">
                        {r.menuName || (
                          <em className="text-neutral-400">(no name)</em>
                        )}
                      </td>
                      <td className="px-3 py-2 text-neutral-600">
                        {r.variant ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-neutral-700">
                        {r.resolvedLines.length} line
                        {r.resolvedLines.some(
                          (ln) => ln.ingredientId === null,
                        ) ? (
                          <Badge variant="danger" className="ml-1">
                            unmapped
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-neutral-600">
                        {r.errors.length > 0 ? (
                          <ul className="list-disc pl-4">
                            {r.errors.slice(0, 3).map((e, i) => (
                              <li key={i}>{e}</li>
                            ))}
                          </ul>
                        ) : r.changedFields.length > 0 ? (
                          <span className="text-neutral-500">
                            Changed: {r.changedFields.join(", ")}
                          </span>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {mode === "applying" ? (
          <div className="flex items-center justify-center gap-2 rounded-md bg-mahakan-green-50 py-4 text-sm text-mahakan-green-900">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Apply transaksi... jangan tutup tab.
          </div>
        ) : null}

        {mode === "done" ? (
          <div className="flex items-start gap-2 rounded-md border border-success-500/40 bg-success-100/40 px-3 py-2 text-sm text-success-500">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>Import sukses. Refresh untuk lihat hasil.</p>
          </div>
        ) : null}

        {error ? (
          <p className="rounded-md border border-danger-500/40 bg-danger-100/40 px-3 py-2 text-sm text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "info" | "danger" | "neutral";
}) {
  const toneClass = {
    success: "border-success-500/40 bg-success-100/40 text-success-500",
    info: "border-info-500/40 bg-info-100/40 text-info-700",
    danger: "border-danger-500/40 bg-danger-100/40 text-danger-500",
    neutral: "border-neutral-300 bg-neutral-50 text-neutral-700",
  }[tone];
  return (
    <div className={cn("rounded-md border p-2", toneClass)}>
      <p className="text-[10px] uppercase tracking-wider">{label}</p>
      <p className="font-mono text-lg font-bold">{value}</p>
    </div>
  );
}

void Upload;
