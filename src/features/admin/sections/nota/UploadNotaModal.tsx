"use client";

/**
 * Sesi AE-149 — Upload Nota modal untuk Back Office.
 *
 * Mirror functionality dari `/m/nota` staff page tapi enhanced untuk
 * back office:
 *  - Wider 2xl modal supaya form lega di desktop
 *  - Drag-drop file zone (di luar plain click)
 *  - Custom Select (Radix) untuk kategori, bukan grid button
 *  - NumericInput dengan rupiah formatting + numpad popup untuk tablet
 *  - 4-col preview grid (desktop) supaya banyak foto muat
 *  - Reuse uploadNotaFiles + createNotaArchive action (sama dengan staff)
 *
 * Permission `nota_archive.create` — owner/manager/supervisor/staff all
 * allowed. Owner pakai via back office, staff via /m/nota.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  Trash2,
  Upload,
  UploadCloud,
} from "lucide-react";
import {
  Button,
  Modal,
  NumericInput,
  Select,
  toast,
} from "@/components/ui";
import {
  CATEGORY_EMOJI,
  CATEGORY_HINTS,
  CATEGORY_LABELS,
  createNotaArchive,
  isOk,
  notaArchiveCategoryValues,
  type NotaArchiveCategory,
} from "@/features/nota-archives";
import { uploadNotaFiles } from "@/features/nota-archives/client-upload";
import { cn } from "@/lib/utils";

interface UploadNotaModalProps {
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
}

const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp,application/pdf";
const ACCEPTED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];
const MAX_FILES = 10;
const MAX_BYTES = 5 * 1024 * 1024;

/** Jakarta YYYY-MM-DD untuk default tanggal. */
function todayJakartaISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function UploadNotaModal({
  open,
  onClose,
  onUploaded,
}: UploadNotaModalProps) {
  const [category, setCategory] = useState<NotaArchiveCategory | "">("");
  const [notaDate, setNotaDate] = useState<string>(() => todayJakartaISO());
  const [description, setDescription] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Reset form whenever modal re-opens. */
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setCategory("");
    setNotaDate(todayJakartaISO());
    setDescription("");
    setAmountStr("");
    setFiles([]);
    setSubmitting(false);
    setProgress(null);
    setError(null);
    setIsDragging(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  function handleFilesAdded(picked: File[]) {
    const valid: File[] = [];
    const errors: string[] = [];
    for (const f of picked) {
      if (f.size > MAX_BYTES) {
        errors.push(`${f.name}: lebih dari 5 MB`);
        continue;
      }
      if (!ACCEPTED_MIME.includes(f.type)) {
        errors.push(`${f.name}: tipe file tidak didukung`);
        continue;
      }
      valid.push(f);
    }
    const next = [...files, ...valid].slice(0, MAX_FILES);
    setFiles(next);
    if (errors.length > 0) {
      toast.error(errors.join("\n"));
    }
    if (files.length + valid.length > MAX_FILES) {
      toast.info(`Maksimal ${MAX_FILES} foto per nota`);
    }
  }

  function removeFile(idx: number) {
    setFiles((f) => f.filter((_, i) => i !== idx));
  }

  function clearAllFiles() {
    setFiles([]);
  }

  async function handleSubmit() {
    if (submitting) return;
    setError(null);
    if (!category) {
      setError("Pilih kategori dulu");
      return;
    }
    if (description.trim().length === 0) {
      setError("Tulis keterangan singkat untuk nota ini");
      return;
    }
    if (files.length === 0) {
      setError("Tambah minimal 1 foto nota");
      return;
    }
    const amount = amountStr.trim()
      ? Number(amountStr.replace(/[^\d]/g, ""))
      : null;
    if (amountStr.trim() && (!Number.isFinite(amount) || (amount ?? 0) < 0)) {
      setError("Nominal tidak valid");
      return;
    }

    setSubmitting(true);
    setProgress({ done: 0, total: files.length });

    const uploadRes = await uploadNotaFiles(
      files,
      { notaDate, category },
      (done, total) => setProgress({ done, total }),
    );

    if (uploadRes.uploaded.length === 0) {
      setError(
        uploadRes.failed[0]?.error.message ??
          "Gagal upload semua file ke Google Drive",
      );
      setSubmitting(false);
      setProgress(null);
      return;
    }

    const res = await createNotaArchive({
      notaDate,
      category,
      description: description.trim(),
      amount,
      files: uploadRes.uploaded,
    });

    setSubmitting(false);
    setProgress(null);

    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    const failedCount = uploadRes.failed.length;
    toast.success(
      failedCount > 0
        ? `Nota tersimpan (${uploadRes.uploaded.length} foto). ${failedCount} foto gagal.`
        : `Nota tersimpan (${uploadRes.uploaded.length} foto)`,
    );
    onUploaded();
  }

  /* Drag-drop overlay. Pasang di body container. */
  function onDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) {
      handleFilesAdded(dropped);
    }
  }

  const categoryOptions = useMemo(
    () =>
      notaArchiveCategoryValues.map((c) => ({
        value: c,
        label: `${CATEGORY_EMOJI[c]}  ${CATEGORY_LABELS[c]}`,
        hint: CATEGORY_HINTS[c],
      })),
    [],
  );

  const canSubmit =
    category !== "" &&
    description.trim().length > 0 &&
    files.length > 0 &&
    !submitting;

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      title="Upload Nota Baru"
      description="Foto nota cash, TOP, operasional, dll. Auto-tersimpan ke Google Drive dengan struktur folder rapi."
      size="2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            onClick={handleSubmit}
            loading={submitting}
            disabled={!canSubmit}
          >
            <Upload className="size-4" aria-hidden /> Simpan Nota
          </Button>
        </>
      }
    >
      <div
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className="relative space-y-6"
      >
        {isDragging ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-mahakan-green-700 bg-mahakan-green-100/90">
            <div className="text-center">
              <UploadCloud className="mx-auto size-12 text-mahakan-green-700" aria-hidden />
              <p className="mt-2 text-base font-semibold text-mahakan-green-900">
                Lepas file di sini
              </p>
              <p className="text-xs text-mahakan-green-700">
                JPG · PNG · WebP · PDF, maks 5 MB / file
              </p>
            </div>
          </div>
        ) : null}

        {/* SECTION 1: Kategori */}
        <FormSection step={1} title="Kategori Nota" required>
          <Select
            ariaLabel="Pilih kategori nota"
            options={categoryOptions}
            value={category}
            onValueChange={(v) => setCategory(v as NotaArchiveCategory)}
            placeholder="— Pilih kategori —"
          />
          {category ? (
            <p className="rounded-md bg-mahakan-green-100/40 px-3 py-2 text-xs text-mahakan-green-900">
              <span className="font-semibold">{CATEGORY_EMOJI[category]} {CATEGORY_LABELS[category]}</span>
              {" — "}
              {CATEGORY_HINTS[category]}
            </p>
          ) : null}
        </FormSection>

        {/* SECTION 2: Detail (tanggal + nominal + keterangan) */}
        <FormSection step={2} title="Detail Nota">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="nota-date"
                className="block text-sm font-medium text-neutral-900"
              >
                Tanggal Nota <span className="text-danger-500">*</span>
              </label>
              <input
                id="nota-date"
                type="date"
                value={notaDate}
                onChange={(e) => setNotaDate(e.target.value)}
                className="h-10 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900 focus:border-mahakan-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
              />
              <p className="text-xs text-neutral-500">
                Tanggal di nota fisik (bukan tanggal upload).
              </p>
            </div>
            <NumericInput
              label="Nominal (opsional)"
              hint="Total rupiah di nota. Boleh kosong kalau nota multi-item."
              prefix="Rp"
              value={amountStr}
              onChange={setAmountStr}
              formatThousands
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="nota-desc"
              className="block text-sm font-medium text-neutral-900"
            >
              Keterangan singkat{" "}
              <span className="text-danger-500">*</span>
            </label>
            <textarea
              id="nota-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder='Contoh: "Bayar listrik PLN bulan Mei" atau "Belanja kopi @Pak Slamet"'
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-mahakan-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
            />
            <div className="flex items-center justify-between text-xs text-neutral-500">
              <span>Jelaskan tujuan / supplier / nomor invoice.</span>
              <span className="tabular-nums">
                {description.length}/500
              </span>
            </div>
          </div>
        </FormSection>

        {/* SECTION 3: Foto Nota — drag-drop + multi-file */}
        <FormSection
          step={3}
          title="Foto Nota"
          required
          rightSlot={
            files.length > 0 ? (
              <span className="text-xs text-neutral-500">
                {files.length}/{MAX_FILES} siap upload
              </span>
            ) : null
          }
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) {
                handleFilesAdded(Array.from(e.target.files));
                e.target.value = "";
              }
            }}
          />

          {files.length === 0 ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 px-4 py-10 transition-colors hover:border-mahakan-green-700 hover:bg-mahakan-green-50/40"
            >
              <div className="flex size-14 items-center justify-center rounded-full bg-white shadow-sm">
                <UploadCloud className="size-7 text-mahakan-green-700" aria-hidden />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-neutral-900">
                  Klik untuk pilih foto, atau drag &amp; drop ke sini
                </p>
                <p className="mt-1 text-xs text-neutral-600">
                  Maks {MAX_FILES} foto · 5 MB per file · JPG / PNG / WebP / PDF
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <Camera className="size-3.5" aria-hidden /> Foto kamera
                <span aria-hidden>·</span>
                <ImageIcon className="size-3.5" aria-hidden /> Galeri
                <span aria-hidden>·</span>
                <FileText className="size-3.5" aria-hidden /> PDF
              </div>
            </button>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {files.map((f, idx) => (
                  <FilePreviewCard
                    key={`${f.name}-${idx}`}
                    file={f}
                    onRemove={() => removeFile(idx)}
                  />
                ))}
                {files.length < MAX_FILES ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex aspect-square items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 transition-colors hover:border-mahakan-green-700 hover:bg-mahakan-green-50/40"
                    aria-label="Tambah foto"
                  >
                    <Plus className="size-6 text-neutral-500" aria-hidden />
                  </button>
                ) : null}
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-neutral-500">
                  Drag &amp; drop file lain ke modal untuk tambah cepat.
                </p>
                <button
                  type="button"
                  onClick={clearAllFiles}
                  className="text-xs font-medium text-danger-500 hover:underline"
                >
                  Hapus semua
                </button>
              </div>
            </div>
          )}
        </FormSection>

        {progress ? (
          <div className="rounded-lg border border-mahakan-green-700/30 bg-mahakan-green-50 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-mahakan-green-900">
                Uploading {progress.done}/{progress.total} foto…
              </p>
              <Loader2 className="size-4 animate-spin text-mahakan-green-700" aria-hidden />
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
              <div
                className="h-full bg-mahakan-green-700 transition-all duration-300"
                style={{
                  width: `${
                    progress.total > 0
                      ? (progress.done / progress.total) * 100
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-danger-500/40 bg-danger-100/50 px-3 py-2 text-sm font-medium text-danger-500"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/** Form section dengan numbered step indicator. */
function FormSection({
  step,
  title,
  required,
  rightSlot,
  children,
}: {
  step: number;
  title: string;
  required?: boolean;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
          <span className="inline-flex size-5 items-center justify-center rounded-full bg-mahakan-green-700 text-[10px] font-bold text-white">
            {step}
          </span>
          {title}
          {required ? (
            <span className="text-danger-500" aria-hidden>
              *
            </span>
          ) : null}
        </h3>
        {rightSlot}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** Single file preview card with thumbnail + remove button. */
function FilePreviewCard({
  file,
  onRemove,
}: {
  file: File;
  onRemove: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (file.type === "application/pdf") return;
    const u = URL.createObjectURL(file);
    /* eslint-disable react-hooks/set-state-in-effect */
    setUrl(u);
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => URL.revokeObjectURL(u);
  }, [file]);
  const isPdf = file.type === "application/pdf";

  return (
    <div className="group relative overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100">
      <div className="aspect-square">
        {isPdf ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
            <FileText className="size-7 text-neutral-500" aria-hidden />
            <p className="line-clamp-2 text-[10px] font-medium text-neutral-700">
              {file.name}
            </p>
          </div>
        ) : url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={url}
            alt={file.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-neutral-400" aria-hidden />
          </div>
        )}
      </div>
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-[10px] text-white",
        )}
      >
        <p className="truncate font-medium">{file.name}</p>
        <p className="opacity-80">{formatBytes(file.size)}</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1.5 top-1.5 inline-flex size-7 items-center justify-center rounded-full bg-white/90 text-danger-500 shadow-sm transition-opacity hover:bg-white"
        aria-label={`Hapus ${file.name}`}
      >
        <Trash2 className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
