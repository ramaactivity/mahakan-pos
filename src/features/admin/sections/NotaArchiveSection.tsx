"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  FileText,
  Filter,
  FlagTriangleRight,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Modal,
  Select,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  CATEGORY_EMOJI,
  CATEGORY_LABELS,
  STATUS_LABELS,
  deleteNotaArchive,
  getNotaArchive,
  getNotaArchiveStats,
  isOk,
  listNotaArchives,
  notaArchiveCategoryValues,
  reviewNotaArchive,
  updateNotaArchive,
  type NotaArchiveCategory,
  type NotaArchiveStatus,
  type PublicNotaArchiveWithFiles,
} from "@/features/nota-archives";
import type { Role } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";
import { cn } from "@/lib/utils";
import { UploadNotaModal } from "./nota/UploadNotaModal";

interface NotaArchiveSectionProps {
  viewerRole: Role;
}

const STATUS_FILTERS: Array<NotaArchiveStatus | "all"> = [
  "pending_review",
  "all",
  "reviewed",
  "flagged",
];

const STATUS_FILTER_LABELS: Record<NotaArchiveStatus | "all", string> = {
  pending_review: "Menunggu Review",
  all: "Semua",
  reviewed: "Sudah Dicek",
  flagged: "Diperhatikan",
};

export function NotaArchiveSection({ viewerRole }: NotaArchiveSectionProps) {
  const queryClient = useQueryClient();

  /* Filter state */
  const [statusFilter, setStatusFilter] = useState<NotaArchiveStatus | "all">(
    "pending_review",
  );
  const [categoryFilter, setCategoryFilter] = useState<
    NotaArchiveCategory | "all"
  >("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  /* Debounced search */
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 350);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const queryFilters = useMemo(
    () => ({
      status: statusFilter === "all" ? undefined : statusFilter,
      category: categoryFilter === "all" ? undefined : categoryFilter,
      search: debouncedSearch || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }),
    [statusFilter, categoryFilter, debouncedSearch, dateFrom, dateTo],
  );

  const { data: stats } = useQuery({
    queryKey: ["nota-archive", "stats"],
    queryFn: async () => {
      const res = await getNotaArchiveStats();
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["nota-archive", "list", queryFilters],
    queryFn: async () => {
      const res = await listNotaArchives(queryFilters);
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["nota-archive"] });
  }

  const [detailId, setDetailId] = useState<string | null>(null);
  /* Sesi AE-149 — Upload nota dari back office (mirror staff /m/nota). */
  const [uploadOpen, setUploadOpen] = useState(false);
  const canUpload = hasPermission(viewerRole, "nota_archive.create");

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-mahakan-green-900">
            Arsip Nota
          </h1>
          <p className="text-sm text-neutral-700">
            Foto nota dari staff (cash, TOP, operasional, dll). Review &
            download di sini, file fisik tersimpan rapi di Google Drive.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCcw className="size-4" aria-hidden /> Refresh
          </Button>
          {canUpload ? (
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <Plus className="size-4" aria-hidden /> Upload Nota
            </Button>
          ) : null}
        </div>
      </header>

      {/* Stats — wider cards dengan icon + helper text. */}
      {stats ? (
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard
            label="Menunggu Review"
            value={stats.pendingReview}
            tone="warning"
            icon={<AlertCircle className="size-5" aria-hidden />}
            helper="Belum diverifikasi oleh manager"
          />
          <StatCard
            label="Sudah Dicek (bulan ini)"
            value={stats.reviewedThisMonth}
            tone="success"
            icon={<CheckCircle2 className="size-5" aria-hidden />}
            helper="Reviewed & marked clean"
          />
          <StatCard
            label="Total Nota Bulan Ini"
            value={stats.totalThisMonth}
            tone="neutral"
            icon={<FileText className="size-5" aria-hidden />}
            helper="Termasuk semua status"
          />
        </div>
      ) : null}

      {/* Status tabs + search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex flex-wrap rounded-lg border border-neutral-200 bg-white p-1">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                statusFilter === s
                  ? "bg-mahakan-green-700 text-white"
                  : "text-neutral-700 hover:bg-neutral-100",
              )}
            >
              {STATUS_FILTER_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" aria-hidden />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Cari keterangan…"
            className="pl-9"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowFilters((v) => !v)}
        >
          <Filter className="size-4" aria-hidden /> Filter lanjut
          <ChevronDown
            className={cn(
              "size-3.5 transition-transform",
              showFilters && "rotate-180",
            )}
            aria-hidden
          />
        </Button>
      </div>

      {showFilters ? (
        <div className="grid gap-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4 sm:grid-cols-3">
          <Select
            label="Kategori"
            ariaLabel="Filter kategori"
            options={[
              { value: "all", label: "Semua kategori" },
              ...notaArchiveCategoryValues.map((c) => ({
                value: c,
                label: `${CATEGORY_EMOJI[c]}  ${CATEGORY_LABELS[c]}`,
              })),
            ]}
            value={categoryFilter}
            onValueChange={(v) =>
              setCategoryFilter(v as NotaArchiveCategory | "all")
            }
            size="sm"
          />
          <div className="space-y-1.5">
            <label
              htmlFor="nota-date-from"
              className="block text-sm font-medium text-neutral-900"
            >
              Tanggal dari
            </label>
            <input
              id="nota-date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm focus:border-mahakan-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="nota-date-to"
              className="block text-sm font-medium text-neutral-900"
            >
              Tanggal sampai
            </label>
            <input
              id="nota-date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm focus:border-mahakan-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
            />
          </div>
        </div>
      ) : null}

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <FileText className="mx-auto size-8 text-neutral-400" aria-hidden />
            <p className="mt-2 text-sm font-medium text-neutral-900">
              Tidak ada nota
            </p>
            <p className="mt-1 text-xs text-neutral-600">
              Coba ubah filter atau tunggu staff upload nota baru.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm">
                <thead className="bg-neutral-50 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-3">Tanggal</th>
                    <th className="px-4 py-3">Kategori</th>
                    <th className="px-4 py-3">Keterangan</th>
                    <th className="px-4 py-3 text-right">Nominal</th>
                    <th className="px-4 py-3">Uploader</th>
                    <th className="px-4 py-3">Foto</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {data.items.map((nota) => (
                    <tr
                      key={nota.id}
                      className="cursor-pointer transition-colors hover:bg-mahakan-green-50/30"
                      onClick={() => setDetailId(nota.id)}
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-neutral-900">
                        {formatDateID(nota.notaDate)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          <span aria-hidden>
                            {CATEGORY_EMOJI[nota.category]}
                          </span>
                          <span className="text-xs">
                            {CATEGORY_LABELS[nota.category]}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-neutral-900">
                        <p className="line-clamp-2 max-w-md">
                          {nota.description}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-neutral-700">
                        {nota.amount
                          ? formatRupiah(Number(nota.amount))
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-neutral-700">
                        {nota.createdByName}
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-neutral-700">
                        {nota.fileCount}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={nota.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDetailId(nota.id);
                          }}
                          aria-label="Lihat detail"
                        >
                          <Eye className="size-4" aria-hidden />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.total > data.items.length ? (
              <div className="border-t border-neutral-100 bg-neutral-50 px-4 py-2 text-xs text-neutral-500">
                Menampilkan {data.items.length} dari {data.total} nota. Sempit
                rentang tanggal untuk lihat lebih spesifik.
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {detailId ? (
        <NotaDetailModal
          id={detailId}
          viewerRole={viewerRole}
          onClose={() => setDetailId(null)}
          onChanged={() => {
            refresh();
          }}
          onDeleted={() => {
            setDetailId(null);
            refresh();
          }}
        />
      ) : null}

      <UploadNotaModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => {
          setUploadOpen(false);
          refresh();
        }}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  icon,
  helper,
}: {
  label: string;
  value: number;
  tone: "warning" | "success" | "neutral";
  icon?: React.ReactNode;
  helper?: string;
}) {
  return (
    <Card
      className={cn(
        "border-l-4 transition-shadow hover:shadow-md",
        tone === "warning"
          ? "border-l-warning-500"
          : tone === "success"
            ? "border-l-mahakan-green-700"
            : "border-l-neutral-300",
      )}
    >
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
            {label}
          </p>
          <p
            className={cn(
              "mt-1.5 text-3xl font-bold tabular-nums",
              tone === "warning"
                ? "text-warning-500"
                : tone === "success"
                  ? "text-mahakan-green-900"
                  : "text-neutral-900",
            )}
          >
            {value}
          </p>
          {helper ? (
            <p className="mt-1 text-[11px] text-neutral-500">{helper}</p>
          ) : null}
        </div>
        <div
          className={cn(
            "flex size-10 flex-none items-center justify-center rounded-full",
            tone === "warning"
              ? "bg-warning-100/60 text-warning-500"
              : tone === "success"
                ? "bg-mahakan-green-100/60 text-mahakan-green-900"
                : "bg-neutral-100 text-neutral-500",
          )}
        >
          {icon ?? <FileText className="size-5" aria-hidden />}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: NotaArchiveStatus }) {
  if (status === "reviewed")
    return <Badge variant="success">{STATUS_LABELS[status]}</Badge>;
  if (status === "flagged")
    return <Badge variant="danger">{STATUS_LABELS[status]}</Badge>;
  return <Badge variant="warning">{STATUS_LABELS[status]}</Badge>;
}

/* ============================================================
 * Detail modal — owner/manager can review/flag/unreview, delete
 * ============================================================ */

interface DetailModalProps {
  id: string;
  viewerRole: Role;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}

function NotaDetailModal({
  id,
  viewerRole,
  onClose,
  onChanged,
  onDeleted,
}: DetailModalProps) {
  const [archive, setArchive] = useState<PublicNotaArchiveWithFiles | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [reviewerNote, setReviewerNote] = useState("");
  const [pendingAction, setPendingAction] =
    useState<null | "review" | "flag" | "unreview" | "delete">(null);
  const [submitting, setSubmitting] = useState(false);

  const canReview = viewerRole === "owner" || viewerRole === "manager";
  const canDelete = canReview;
  const canEdit = canReview;

  /* Edit mode (sesi AE-161) — owner sering ngeh tanggal/nominal/keterangan
   * salah pas udah submit (tulisan nota kadang siwer). */
  const [editing, setEditing] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editCategory, setEditCategory] =
    useState<NotaArchiveCategory>("pembelian_cash");
  const [editDesc, setEditDesc] = useState("");
  const [editAmount, setEditAmount] = useState("");

  /* Semua file 1 nota berada di folder Drive yang sama (per kategori/bulan),
   * jadi ambil driveFolderId pertama yang ada. */
  const driveFolderId =
    archive?.files.find((f) => f.driveFolderId)?.driveFolderId ?? null;
  const driveFolderUrl = driveFolderId
    ? `https://drive.google.com/drive/folders/${driveFolderId}`
    : null;

  function openEdit() {
    if (!archive) return;
    setEditDate(archive.notaDate);
    setEditCategory(archive.category);
    setEditDesc(archive.description);
    setEditAmount(
      archive.amount ? String(Math.round(Number(archive.amount))) : "",
    );
    setEditing(true);
  }

  async function handleSaveEdit() {
    if (!archive || submitting) return;
    if (editDesc.trim().length === 0) {
      toast.error("Keterangan wajib diisi");
      return;
    }
    const digits = editAmount.replace(/[^\d]/g, "");
    const amountNum = digits === "" ? null : Number(digits);
    if (amountNum !== null && !Number.isFinite(amountNum)) {
      toast.error("Nominal tidak valid");
      return;
    }
    setSubmitting(true);
    const res = await updateNotaArchive({
      id: archive.id,
      notaDate: editDate,
      category: editCategory,
      description: editDesc.trim(),
      amount: amountNum,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    setArchive(res.data);
    setEditing(false);
    toast.success("Nota diperbarui");
    onChanged();
  }

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
      setReviewerNote(res.data.reviewerNote ?? "");
      setLoading(false);
    })();
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleStatusChange(
    next: "reviewed" | "flagged" | "pending_review",
  ) {
    if (!archive || submitting) return;
    setSubmitting(true);
    const res = await reviewNotaArchive({
      id: archive.id,
      status: next,
      reviewerNote: reviewerNote.trim() || null,
    });
    setSubmitting(false);
    setPendingAction(null);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    setArchive(res.data);
    toast.success(
      next === "reviewed"
        ? "Mark sudah dicek"
        : next === "flagged"
          ? "Mark perlu diperhatikan"
          : "Reset ke pending review",
    );
    onChanged();
  }

  async function handleDelete() {
    if (!archive || submitting) return;
    setSubmitting(true);
    const res = await deleteNotaArchive(archive.id);
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Nota dihapus");
    onDeleted();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Detail Nota"
      size="xl"
      footer={
        editing ? (
          <>
            <Button
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button onClick={handleSaveEdit} loading={submitting}>
              <CheckCircle2 className="size-4" aria-hidden /> Simpan Perubahan
            </Button>
          </>
        ) : (
          <>
            {canDelete && archive ? (
              <Button
                variant="ghost"
                onClick={() => setPendingAction("delete")}
                disabled={submitting}
                className="text-danger-500 hover:bg-danger-100/50"
              >
                Hapus
              </Button>
            ) : null}
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              Tutup
            </Button>
            {canEdit && archive ? (
              <Button
                variant="outline"
                onClick={openEdit}
                disabled={submitting}
              >
                <Pencil className="size-4" aria-hidden /> Edit
              </Button>
            ) : null}
            {canReview && archive && archive.status !== "reviewed" ? (
              <Button
                onClick={() => handleStatusChange("reviewed")}
                loading={submitting && pendingAction !== "delete"}
              >
                <CheckCircle2 className="size-4" aria-hidden /> Mark Sudah Dicek
              </Button>
            ) : null}
          </>
        )
      }
    >
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-neutral-400" />
        </div>
      ) : !archive ? (
        <p className="text-sm text-neutral-700">Data tidak tersedia.</p>
      ) : (
        <div className="space-y-5">
          {/* Header info — atau form edit saat mode edit. */}
          {editing ? (
            <div className="space-y-3 rounded-lg border border-mahakan-green-200 bg-mahakan-green-50/40 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-mahakan-green-900">
                Edit Nota
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label
                    htmlFor="edit-nota-date"
                    className="block text-xs font-medium text-neutral-900"
                  >
                    Tanggal nota
                  </label>
                  <input
                    id="edit-nota-date"
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm focus:border-mahakan-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
                  />
                </div>
                <Select
                  label="Kategori"
                  ariaLabel="Edit kategori"
                  options={notaArchiveCategoryValues.map((c) => ({
                    value: c,
                    label: `${CATEGORY_EMOJI[c]}  ${CATEGORY_LABELS[c]}`,
                  }))}
                  value={editCategory}
                  onValueChange={(v) =>
                    setEditCategory(v as NotaArchiveCategory)
                  }
                  size="sm"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="edit-nota-desc"
                  className="block text-xs font-medium text-neutral-900"
                >
                  Keterangan
                </label>
                <input
                  id="edit-nota-desc"
                  type="text"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  maxLength={500}
                  placeholder="Mis. Bahan baku, bayar listrik PLN…"
                  className="h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm focus:border-mahakan-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="edit-nota-amount"
                  className="block text-xs font-medium text-neutral-900"
                >
                  Nominal (Rp) — boleh dikosongkan
                </label>
                <input
                  id="edit-nota-amount"
                  inputMode="numeric"
                  value={
                    editAmount === ""
                      ? ""
                      : Number(editAmount).toLocaleString("id-ID")
                  }
                  onChange={(e) =>
                    setEditAmount(e.target.value.replace(/[^\d]/g, ""))
                  }
                  placeholder="0"
                  className="h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-right font-mono text-sm focus:border-mahakan-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
                />
              </div>
              <p className="text-[11px] text-neutral-500">
                Foto nota tidak ikut berubah — cuma data tanggal, kategori,
                keterangan, dan nominal.
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <div
                className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-white text-xl ring-1 ring-inset ring-neutral-200"
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
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-600">
                  <span>{formatDateID(archive.notaDate)}</span>
                  {archive.amount ? (
                    <span className="font-mono text-neutral-900">
                      {formatRupiah(Number(archive.amount))}
                    </span>
                  ) : null}
                  <span>Upload: {archive.createdByName}</span>
                  <span>
                    {archive.createdAt.toLocaleString("id-ID", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusBadge status={archive.status} />
                  {archive.reviewedByName ? (
                    <span className="text-[11px] text-neutral-500">
                      oleh {archive.reviewedByName}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {/* Files grid */}
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Foto Nota ({archive.files.length})
              </h3>
              {driveFolderUrl ? (
                <a
                  href={driveFolderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-mahakan-green-700 bg-white px-3 py-1.5 text-xs font-semibold text-mahakan-green-900 hover:bg-mahakan-green-50"
                >
                  <FolderOpen className="size-3.5" aria-hidden /> Buka Folder di
                  Drive
                </a>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {archive.files.map((f) => (
                <FileThumb key={f.id} file={f} />
              ))}
            </div>
          </section>

          {/* Reviewer note */}
          {editing ? null : canReview ? (
            <section className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Catatan Reviewer (opsional)
              </label>
              <textarea
                value={reviewerNote}
                onChange={(e) => setReviewerNote(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder='Mis. "OK, masuk laporan operasional Mei" atau "Nominalnya kok beda? Cek dulu"'
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-mahakan-green-700 focus:outline-none"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleStatusChange("flagged")}
                  loading={submitting && pendingAction === "flag"}
                  className="text-danger-500 hover:bg-danger-100/50"
                >
                  <FlagTriangleRight className="size-3.5" aria-hidden />
                  Mark Perlu Diperhatikan
                </Button>
                {archive.status !== "pending_review" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleStatusChange("pending_review")}
                    loading={submitting && pendingAction === "unreview"}
                  >
                    Reset ke Pending
                  </Button>
                ) : null}
              </div>
            </section>
          ) : archive.reviewerNote ? (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                Catatan Reviewer
              </p>
              <p className="mt-1 text-xs italic text-neutral-700">
                “{archive.reviewerNote}”
              </p>
            </div>
          ) : null}
        </div>
      )}

      {/* Delete confirm */}
      <Modal
        open={pendingAction === "delete"}
        onClose={() => setPendingAction(null)}
        title="Hapus nota?"
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setPendingAction(null)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              loading={submitting}
            >
              Hapus permanen
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-700">
          File di Google Drive tetap ada — tapi nota ini hilang dari daftar
          back office + staff. Pastikan sudah backup kalau perlu.
        </p>
      </Modal>
    </Modal>
  );
}

function FileThumb({
  file,
}: {
  file: PublicNotaArchiveWithFiles["files"][number];
}) {
  const isImg = file.contentType.startsWith("image/");
  const isPdf = file.contentType === "application/pdf";
  return (
    <a
      href={file.fileUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block aspect-square overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100"
    >
      {isImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={driveThumbUrl(file.driveFileId)}
          alt={file.originalName}
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : isPdf ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
          <FileText className="size-7 text-danger-500" aria-hidden />
          <p className="line-clamp-2 text-[10px] text-neutral-700">
            {file.originalName}
          </p>
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <FileText className="size-6 text-neutral-400" aria-hidden />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
        <span className="inline-flex items-center gap-1">
          <Eye className="size-3" aria-hidden /> Lihat
        </span>
        <Download className="size-3" aria-hidden />
      </div>
    </a>
  );
}

function driveThumbUrl(fileId: string): string {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w480`;
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

/* Silence unused lint */
void X;
