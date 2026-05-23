"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronRight,
  ClipboardEdit,
  Eye,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Spinner, toast } from "@/components/ui";
import { useSession } from "@/features/auth/SessionProvider";
import {
  CATEGORY_EMOJI,
  CATEGORY_HINTS,
  CATEGORY_LABELS,
  createNotaArchive,
  deleteNotaArchive,
  getMyRecentNotaArchives,
  getNotaArchive,
  isOk,
  notaArchiveCategoryValues,
  type NotaArchiveCategory,
  type PublicNotaArchive,
  type PublicNotaArchiveWithFiles,
} from "@/features/nota-archives";
import { uploadNotaFiles } from "@/features/nota-archives/client-upload";
import { cn } from "@/lib/utils";

interface PageState {
  items: PublicNotaArchive[];
  loading: boolean;
}

export default function NotaArchivePage() {
  const router = useRouter();
  const { status, session } = useSession();

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated" || !session) {
      router.replace("/m/login");
    }
  }, [status, session, router]);

  const [state, setState] = useState<PageState>({ items: [], loading: true });
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  async function refresh() {
    setState((s) => ({ ...s, loading: true }));
    const res = await getMyRecentNotaArchives(20);
    if (!isOk(res)) {
      toast.error(res.error.message);
      setState({ items: [], loading: false });
      return;
    }
    setState({ items: res.data, loading: false });
  }

  useEffect(() => {
    if (!session) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    void refresh();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [session]);

  if (status === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-6 text-mahakan-green-700" />
      </div>
    );
  }
  if (status === "unauthenticated" || !session) return null;

  return (
    <div className="space-y-5 pb-24">
      <header className="flex items-center gap-3">
        <Link
          href="/m"
          className="inline-flex size-9 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
          aria-label="Kembali"
        >
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
        <div>
          <h1 className="text-lg font-bold text-mahakan-green-900">
            Arsip Nota
          </h1>
          <p className="text-xs text-neutral-600">
            Upload foto nota cash, TOP, operasional. Disimpan rapi di Drive
            Owner.
          </p>
        </div>
      </header>

      <section className="rounded-xl border border-mahakan-green-700/20 bg-mahakan-green-50 p-4">
        <p className="text-xs text-mahakan-green-900/80">
          <strong>Kenapa wajib upload?</strong>
        </p>
        <p className="mt-1 text-xs text-mahakan-green-900/80">
          Saat Owner/Manager tidak di tempat, kamu tetap bisa simpan bukti
          nota di sini supaya rapi, tidak hilang, dan langsung bisa dicek dari
          jauh.
        </p>
      </section>

      <button
        type="button"
        onClick={() => setFormOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-mahakan-green-700 py-3.5 text-sm font-semibold text-white shadow-sm transition-transform active:scale-[0.99]"
      >
        <Plus className="size-4" aria-hidden />
        Upload Nota Baru
      </button>

      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Nota yang Kamu Upload
        </h2>
        {state.loading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-neutral-400" />
          </div>
        ) : state.items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center">
            <FileText className="mx-auto size-6 text-neutral-400" aria-hidden />
            <p className="mt-2 text-sm font-medium text-neutral-900">
              Belum ada nota
            </p>
            <p className="mt-1 text-xs text-neutral-600">
              Foto nota apa pun (cash/TOP/listrik/dll) dan upload di sini.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {state.items.map((nota) => (
              <li key={nota.id}>
                <button
                  type="button"
                  onClick={() => setDetailId(nota.id)}
                  className="flex w-full items-start gap-3 rounded-xl border border-neutral-200 bg-white p-3 text-left transition-colors hover:border-mahakan-green-700/50 active:bg-mahakan-green-50/40"
                >
                  <div
                    className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-mahakan-green-100 text-xl"
                    aria-hidden
                  >
                    {CATEGORY_EMOJI[nota.category]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-neutral-700">
                        {CATEGORY_LABELS[nota.category]}
                      </span>
                      <StatusBadge status={nota.status} />
                    </div>
                    <p className="mt-1 truncate text-sm font-medium text-neutral-900">
                      {nota.description}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-neutral-600">
                      <span>{formatDateID(nota.notaDate)}</span>
                      <span>·</span>
                      <span>
                        {nota.fileCount} foto
                        {nota.amount
                          ? ` · ${formatRupiah(Number(nota.amount))}`
                          : ""}
                      </span>
                    </p>
                  </div>
                  <ChevronRight className="mt-1 size-4 shrink-0 text-neutral-400" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {formOpen ? (
        <UploadFormModal
          onClose={() => setFormOpen(false)}
          onSubmitted={() => {
            setFormOpen(false);
            void refresh();
          }}
        />
      ) : null}

      {detailId ? (
        <DetailModal
          id={detailId}
          onClose={() => setDetailId(null)}
          onDeleted={() => {
            setDetailId(null);
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/* ============================================================
 * Status badge
 * ============================================================ */

function StatusBadge({ status }: { status: PublicNotaArchive["status"] }) {
  if (status === "reviewed")
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-mahakan-green-100 px-1.5 py-0.5 text-[10px] font-bold text-mahakan-green-900">
        <CheckCircle2 className="size-2.5" aria-hidden /> Dicek
      </span>
    );
  if (status === "flagged")
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-danger-100 px-1.5 py-0.5 text-[10px] font-bold text-danger-500">
        <AlertCircle className="size-2.5" aria-hidden /> Diperhatikan
      </span>
    );
  return (
    <span className="rounded-full bg-warning-100 px-1.5 py-0.5 text-[10px] font-bold text-warning-500">
      Pending
    </span>
  );
}

/* ============================================================
 * Upload form modal
 * ============================================================ */

interface UploadFormModalProps {
  onClose: () => void;
  onSubmitted: () => void;
}

const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp,application/pdf";
const MAX_FILES = 10;
const MAX_BYTES = 5 * 1024 * 1024;

function UploadFormModal({ onClose, onSubmitted }: UploadFormModalProps) {
  const [category, setCategory] = useState<NotaArchiveCategory | null>(null);
  const [notaDate, setNotaDate] = useState<string>(() => todayJakartaISO());
  const [description, setDescription] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFilesAdded(picked: File[]) {
    const valid: File[] = [];
    const errors: string[] = [];
    for (const f of picked) {
      if (f.size > MAX_BYTES) {
        errors.push(`${f.name}: lebih dari 5MB`);
        continue;
      }
      const ok = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/pdf",
      ].includes(f.type);
      if (!ok) {
        errors.push(`${f.name}: tipe tidak didukung`);
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
      toast.info(`Maks ${MAX_FILES} foto per nota`);
    }
  }

  function removeFile(idx: number) {
    setFiles((f) => f.filter((_, i) => i !== idx));
  }

  async function handleSubmit() {
    if (submitting) return;
    setError(null);
    if (!category) {
      setError("Pilih kategori dulu");
      return;
    }
    if (description.trim().length === 0) {
      setError("Tulis keterangan singkat");
      return;
    }
    if (files.length === 0) {
      setError("Tambah minimal 1 foto nota");
      return;
    }
    const amount = amountStr.trim()
      ? Number(amountStr.replace(/[^\d]/g, ""))
      : null;
    if (amountStr.trim() && !Number.isFinite(amount)) {
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
        uploadRes.failed[0]?.error.message ?? "Gagal upload semua file",
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
        ? `Nota tersimpan (${uploadRes.uploaded.length} foto). ${failedCount} foto gagal upload.`
        : `Nota tersimpan (${uploadRes.uploaded.length} foto)`,
    );
    onSubmitted();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Upload nota"
      className="fixed inset-0 z-50 flex flex-col bg-white sm:items-center sm:justify-center sm:bg-black/50 sm:p-4"
    >
      <div className="flex flex-col h-full max-h-screen w-full overflow-hidden bg-white sm:max-h-[92vh] sm:max-w-lg sm:rounded-2xl sm:shadow-xl">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-4 py-3">
          <div>
            <h2 className="text-base font-bold text-mahakan-green-900">
              Upload Nota Baru
            </h2>
            <p className="text-[11px] text-neutral-600">
              Foto rapi, baca jelas, kasih keterangan singkat.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex size-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 disabled:opacity-50"
            aria-label="Tutup"
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {/* Category */}
          <section className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500">
              1. Kategori Nota
            </label>
            <div className="grid grid-cols-2 gap-2">
              {notaArchiveCategoryValues.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={cn(
                    "flex items-start gap-2 rounded-lg border p-2.5 text-left transition-colors",
                    category === c
                      ? "border-mahakan-green-700 bg-mahakan-green-50"
                      : "border-neutral-200 bg-white hover:bg-neutral-50",
                  )}
                >
                  <span className="text-lg" aria-hidden>
                    {CATEGORY_EMOJI[c]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "text-xs font-semibold",
                        category === c
                          ? "text-mahakan-green-900"
                          : "text-neutral-900",
                      )}
                    >
                      {CATEGORY_LABELS[c]}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[10px] text-neutral-600">
                      {CATEGORY_HINTS[c]}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Date + amount */}
          <section className="space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500">
              2. Detail Nota
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="nota-date"
                  className="block text-xs text-neutral-700"
                >
                  Tanggal Nota
                </label>
                <input
                  id="nota-date"
                  type="date"
                  value={notaDate}
                  onChange={(e) => setNotaDate(e.target.value)}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-mahakan-green-700 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="nota-amount"
                  className="block text-xs text-neutral-700"
                >
                  Nominal (opsional)
                </label>
                <div className="relative mt-1">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-neutral-500">
                    Rp
                  </span>
                  <input
                    id="nota-amount"
                    type="text"
                    inputMode="numeric"
                    value={amountStr ? formatRupiahInput(amountStr) : ""}
                    onChange={(e) =>
                      setAmountStr(e.target.value.replace(/[^\d]/g, ""))
                    }
                    placeholder="0"
                    className="w-full rounded-md border border-neutral-300 pl-8 pr-3 py-2 text-sm focus:border-mahakan-green-700 focus:outline-none"
                  />
                </div>
              </div>
            </div>
            <div>
              <label
                htmlFor="nota-desc"
                className="block text-xs text-neutral-700"
              >
                Keterangan singkat *
              </label>
              <textarea
                id="nota-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder='Contoh: "Bayar listrik PLN bulan Mei" atau "Belanja kopi @Pak Slamet"'
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-mahakan-green-700 focus:outline-none"
              />
            </div>
          </section>

          {/* Files */}
          <section className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500">
              3. Foto Nota
            </label>
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
                className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 px-4 py-6 transition-colors hover:bg-neutral-100"
              >
                <Camera className="size-6 text-neutral-500" aria-hidden />
                <p className="text-sm font-medium text-neutral-900">
                  Ambil foto / pilih dari galeri
                </p>
                <p className="text-[11px] text-neutral-600">
                  Boleh 1 atau banyak. Max {MAX_FILES} foto · 5MB per file ·
                  JPG / PNG / PDF
                </p>
              </button>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  {files.map((f, idx) => (
                    <FilePreview
                      key={`${f.name}-${idx}`}
                      file={f}
                      onRemove={() => removeFile(idx)}
                    />
                  ))}
                  {files.length < MAX_FILES ? (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex aspect-square items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 hover:bg-neutral-100"
                      aria-label="Tambah foto"
                    >
                      <Plus className="size-5 text-neutral-500" aria-hidden />
                    </button>
                  ) : null}
                </div>
                <p className="text-[11px] text-neutral-600">
                  {files.length}/{MAX_FILES} foto siap di-upload
                </p>
              </div>
            )}
          </section>

          {progress ? (
            <div className="rounded-lg border border-mahakan-green-700/30 bg-mahakan-green-50 p-3">
              <p className="text-xs font-medium text-mahakan-green-900">
                Uploading {progress.done}/{progress.total} foto…
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                <div
                  className="h-full bg-mahakan-green-700 transition-all"
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

        {/* Footer */}
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-neutral-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-md bg-mahakan-green-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform active:scale-[0.99] disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Upload className="size-4" aria-hidden />
            )}
            Simpan Nota
          </button>
        </footer>
      </div>
    </div>
  );
}

function FilePreview({
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
    <div className="relative aspect-square overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100">
      {isPdf ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
          <FileText className="size-6 text-neutral-500" aria-hidden />
          <p className="line-clamp-2 text-[9px] text-neutral-700">
            {file.name}
          </p>
        </div>
      ) : url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={file.name}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <ImageIcon className="size-5 text-neutral-400" aria-hidden />
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 inline-flex size-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
        aria-label={`Hapus ${file.name}`}
      >
        <X className="size-3" aria-hidden />
      </button>
    </div>
  );
}

/* ============================================================
 * Detail modal — view + delete (staff own pending only)
 * ============================================================ */

interface DetailModalProps {
  id: string;
  onClose: () => void;
  onDeleted: () => void;
}

function DetailModal({ id, onClose, onDeleted }: DetailModalProps) {
  const { session } = useSession();
  const [archive, setArchive] = useState<PublicNotaArchiveWithFiles | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    (async () => {
      const res = await getNotaArchive(id);
      if (cancelled) return;
      if (!isOk(res)) {
        toast.error(res.error.message);
        setLoading(false);
        return;
      }
      setArchive(res.data);
      setLoading(false);
    })();
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleDelete() {
    if (!archive || deleting) return;
    setDeleting(true);
    const res = await deleteNotaArchive(archive.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      setDeleting(false);
      return;
    }
    toast.success("Nota dihapus");
    onDeleted();
  }

  const canDelete = useMemo(() => {
    if (!archive || !session) return false;
    if (archive.createdById !== session.user.id) return false;
    return archive.status === "pending_review";
  }, [archive, session]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Detail nota"
      className="fixed inset-0 z-50 flex flex-col bg-white sm:items-center sm:justify-center sm:bg-black/50 sm:p-4"
    >
      <div className="flex h-full max-h-screen w-full flex-col overflow-hidden bg-white sm:max-h-[92vh] sm:max-w-lg sm:rounded-2xl sm:shadow-xl">
        <header className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-4 py-3">
          <h2 className="text-base font-bold text-mahakan-green-900">
            Detail Nota
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100"
            aria-label="Tutup"
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-neutral-400" />
            </div>
          ) : !archive ? (
            <p className="text-sm text-neutral-700">Data tidak tersedia.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div
                  className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-mahakan-green-100 text-xl"
                  aria-hidden
                >
                  {CATEGORY_EMOJI[archive.category]}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold uppercase tracking-wide text-mahakan-green-900">
                    {CATEGORY_LABELS[archive.category]}
                  </p>
                  <p className="text-base font-bold text-neutral-900">
                    {archive.description}
                  </p>
                  <p className="mt-0.5 text-xs text-neutral-600">
                    {formatDateID(archive.notaDate)}
                    {archive.amount
                      ? ` · ${formatRupiah(Number(archive.amount))}`
                      : ""}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <StatusBadge status={archive.status} />
                <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-neutral-700">
                  Upload: {archive.createdByName}
                </span>
              </div>

              {archive.reviewerNote ? (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                    Catatan Reviewer
                  </p>
                  <p className="mt-1 text-xs text-neutral-700 italic">
                    “{archive.reviewerNote}”
                  </p>
                  {archive.reviewedByName ? (
                    <p className="mt-1 text-[10px] text-neutral-500">
                      — {archive.reviewedByName}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  Foto Nota ({archive.files.length})
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {archive.files.map((f) => (
                    <a
                      key={f.id}
                      href={f.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group relative aspect-square overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100"
                    >
                      {f.contentType.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={driveThumbUrl(f.driveFileId)}
                          alt={f.originalName}
                          className="h-full w-full object-cover transition-transform group-hover:scale-105"
                          onError={(e) => {
                            /* Drive thumb url cuma works untuk public files;
                             * fallback ke icon. */
                            const t = e.currentTarget;
                            t.style.display = "none";
                          }}
                        />
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
                          <FileText
                            className="size-6 text-neutral-500"
                            aria-hidden
                          />
                          <p className="line-clamp-2 text-[9px] text-neutral-700">
                            {f.originalName}
                          </p>
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                        <Eye className="mr-1 inline size-3" aria-hidden /> Buka
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-neutral-200 px-4 py-3">
          {canDelete ? (
            pendingDelete ? (
              <div className="flex flex-1 items-center gap-2">
                <p className="text-xs text-neutral-700">Yakin hapus?</p>
                <button
                  type="button"
                  onClick={() => setPendingDelete(false)}
                  disabled={deleting}
                  className="ml-auto rounded px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="inline-flex items-center gap-1 rounded bg-danger-500 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  {deleting ? (
                    <Loader2 className="size-3 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="size-3" aria-hidden />
                  )}
                  Hapus
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPendingDelete(true)}
                className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-danger-500 hover:bg-danger-100/50 px-3 py-1.5"
              >
                <Trash2 className="size-3.5" aria-hidden />
                Hapus
              </button>
            )
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
          >
            Tutup
          </button>
        </footer>
      </div>
    </div>
  );
}

/* Helpers */

function todayJakartaISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatDateID(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "Mei",
    "Jun",
    "Jul",
    "Agu",
    "Sep",
    "Okt",
    "Nov",
    "Des",
  ];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function formatRupiah(n: number): string {
  if (!Number.isFinite(n)) return "Rp 0";
  return `Rp ${n.toLocaleString("id-ID")}`;
}

function formatRupiahInput(raw: string): string {
  if (!raw) return "";
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("id-ID");
}

function driveThumbUrl(fileId: string): string {
  /* Public thumbnail for Drive files yang anyone-with-link reader. */
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w320`;
}

/* Silence unused ClipboardEdit lint (reserved for future edit button). */
void ClipboardEdit;
