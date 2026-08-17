"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownUp,
  CheckCircle2,
  ClipboardList,
  MessageCircle,
  Package,
  TrendingUp,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyCard,
  Input,
  Modal,
  Spinner,
  toast,
} from "@/components/ui";
import {
  cancelPurchaseRequest,
  getPurchaseRequestStats,
  listPurchaseRequests,
  markPurchaseRequestComplete,
  rejectItem,
} from "@/features/purchase-requests/actions";
import { categorizePrItem } from "@/features/purchase-requests/group-items-pure";
import {
  isOk,
  type PurchaseRequestItem,
  type PurchaseRequestStatus,
  type PurchaseRequestWithItems,
} from "@/features/purchase-requests/types";
import { cn } from "@/lib/utils";
import { PurchaseRequestDetailModal } from "./PurchaseRequestDetailModal";
import { CreatePurchaseFromPrModal } from "./inventory/purchases/CreatePurchaseFromPrModal";

type FilterTab = "open" | "partial" | "completed" | "cancelled" | "all";

const FILTERS: Array<{ key: FilterTab; label: string }> = [
  { key: "open", label: "Open" },
  { key: "partial", label: "Sebagian" },
  { key: "completed", label: "Selesai" },
  { key: "cancelled", label: "Dibatalkan" },
  { key: "all", label: "Semua" },
];

const STATUS_LABEL: Record<PurchaseRequestStatus, string> = {
  open: "Open",
  partial: "Sebagian Diterima",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

const STATUS_VARIANT: Record<
  PurchaseRequestStatus,
  "info" | "warning" | "success" | "neutral"
> = {
  open: "info",
  partial: "warning",
  completed: "success",
  cancelled: "neutral",
};

type SortOrder = "newest" | "oldest";

/** Sesi AE-197 — jumlah PR yang diambil per halaman. */
const PAGE_SIZE = 50;

export function PurchaseRequestsSection() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterTab>("open");
  /* Sesi AE-197 — dulu halaman ini memanggil listPurchaseRequests dengan
   * limit 50 MATI, tanpa paging dan tanpa keterangan. Di produksi ada 151 PR,
   * jadi 101 di antaranya tidak pernah terambil sementara kartu statistik di
   * atas tetap menghitung semuanya — itulah "data PR tidak terbaca semua". */
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  /* Sesi AE-122 — explicit sort. Default newest first (yang baru muncul
   * paling atas). Owner request supaya konsisten dan bisa toggle ke
   * oldest (FIFO) kalau perlu prioritize PR lama. */
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");

  /* Sesi AE-177 — PR = daftar permintaan saja. Terima barang HANYA lewat
   * Pembelian/GR (yg gerak stok + biaya). State receive/bulk dibuang. */
  const [cancelTarget, setCancelTarget] = useState<PurchaseRequestWithItems | null>(
    null,
  );
  const [cancelReason, setCancelReason] = useState("");
  const [cancelSubmitting, setCancelSubmitting] = useState(false);

  // Feedback Anisa 2026-06-08 — tandai PR Selesai manual (untuk item yg sengaja
  // tidak dibeli; PR/PO/GR boleh beda tanggal, ini keputusan owner).
  const [completeTarget, setCompleteTarget] =
    useState<PurchaseRequestWithItems | null>(null);
  const [completeSubmitting, setCompleteSubmitting] = useState(false);

  // Sesi AE-19 — per-item reject state.
  const [rejectTarget, setRejectTarget] = useState<{
    item: PurchaseRequestItem;
  } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectSubmitting, setRejectSubmitting] = useState(false);

  // Sesi AE-57 — detail modal state (klik card → modal items)
  const [detailRequest, setDetailRequest] =
    useState<PurchaseRequestWithItems | null>(null);
  // Sesi AE-57 — "Tarik ke Pembelian" wizard, pre-fill dengan PR yang dipilih
  const [pullPrId, setPullPrId] = useState<string | null>(null);

  const {
    data: listResult,
    isLoading: loading,
    isFetching,
    error: queryError,
  } = useQuery({
    queryKey: ["admin", "purchase-requests", { filter, pageSize }],
    queryFn: async () => {
      const res = await listPurchaseRequests({
        status: filter,
        limit: pageSize,
      });
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    placeholderData: (prev) => prev,
  });
  const error =
    queryError instanceof Error ? queryError.message : null;
  const totalCount = listResult?.totalCount ?? 0;
  const hasMore = listResult?.hasMore ?? false;

  /* Sesi AE-122 — client-side sort. Server already returns desc createdAt
   * tapi force re-sort di sini supaya UX konsisten dengan toggle button
   * + defense kalau cache order ke-corrupt. */
  const requests = useMemo(() => {
    const arr = [...(listResult?.items ?? [])];
    arr.sort((a, b) => {
      const diff = b.createdAt.getTime() - a.createdAt.getTime();
      return sortOrder === "newest" ? diff : -diff;
    });
    return arr;
  }, [listResult, sortOrder]);

  // Sesi AE-15 — PR stats dashboard.
  const statsQuery = useQuery({
    queryKey: ["admin", "purchase-requests", "stats"],
    queryFn: async () => {
      const res = await getPurchaseRequestStats();
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 60 * 1000,
  });
  const stats = statsQuery.data ?? null;

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["admin", "purchase-requests"],
    });

  function openReject(item: PurchaseRequestItem) {
    setRejectTarget({ item });
    setRejectReason("");
  }

  async function submitReject() {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (reason.length < 3) {
      toast.error("Alasan minimal 3 karakter");
      return;
    }
    setRejectSubmitting(true);
    const res = await rejectItem({
      itemId: rejectTarget.item.id,
      reason,
    });
    setRejectSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      `Item di-reject · status PR: ${
        res.data.newStatus === "completed"
          ? "Selesai"
          : res.data.newStatus === "partial"
            ? "Sebagian"
            : res.data.newStatus === "cancelled"
              ? "Dibatalkan (semua di-reject)"
              : "Open"
      }`,
    );
    setRejectTarget(null);
    setRejectReason("");
    void refresh();
  }

  async function submitCancel() {
    if (!cancelTarget) return;
    const reason = cancelReason.trim();
    if (reason.length === 0) {
      toast.error("Alasan wajib diisi");
      return;
    }
    setCancelSubmitting(true);
    const res = await cancelPurchaseRequest({
      id: cancelTarget.id,
      reason,
    });
    setCancelSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Permintaan belanja dibatalkan");
    setCancelTarget(null);
    setCancelReason("");
    void refresh();
  }

  async function submitComplete() {
    if (!completeTarget) return;
    setCompleteSubmitting(true);
    const res = await markPurchaseRequestComplete(completeTarget.id);
    setCompleteSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("PR ditandai Selesai");
    setCompleteTarget(null);
    void refresh();
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-mahakan-green-900">
            <ClipboardList className="size-6" aria-hidden /> Permintaan
            Belanja
          </h1>
          <p className="text-sm text-neutral-700">
            Daftar permintaan belanja dari kasir/staff. Untuk membeli &
            menerima barang, proses jadi <strong>Pembelian</strong> di tab{" "}
            <strong>PO</strong> (lewat &quot;Tarik dari PR&quot;) → status PR
            otomatis ter-update saat barang diterima. Status:{" "}
            <strong>Open</strong> → <strong>Sebagian</strong> →{" "}
            <strong>Selesai</strong>.
          </p>
        </div>
      </header>

      {/* Sesi AE-15 — PR Stats dashboard cards */}
      {stats ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <PrStatCard
            Icon={Package}
            label="Open + Partial"
            value={String(stats.openCount + stats.partialCount)}
            sub={
              stats.pendingItemCount > 0
                ? `${stats.pendingItemCount} item belum diproses`
                : "Tidak ada pending"
            }
            accent={
              stats.openCount + stats.partialCount > 0 ? "warning" : "default"
            }
          />
          <PrStatCard
            Icon={AlertTriangle}
            label="Aging > 3 Hari"
            value={String(stats.agingOpenCount)}
            sub={
              stats.agingOpenCount > 0
                ? "PR open yang perlu segera ditindaklanjuti"
                : "Semua PR baru"
            }
            accent={stats.agingOpenCount > 0 ? "danger" : "default"}
          />
          <PrStatCard
            Icon={CheckCircle2}
            label="Selesai Bulan Ini"
            value={String(stats.completedThisMonth)}
            sub="Status completed (semua item diterima)"
            accent="success"
          />
          <PrStatCard
            Icon={TrendingUp}
            label="Total Lifetime"
            value={String(
              stats.openCount +
                stats.partialCount +
                stats.completedCount +
                stats.cancelledCount,
            )}
            sub={`${stats.completedCount} selesai · ${stats.cancelledCount} dibatalkan`}
            accent="default"
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200">
        <div
          role="tablist"
          aria-label="Filter status"
          className="flex flex-wrap gap-1"
        >
          {FILTERS.map((f) => {
            /* Sesi AE-197 — angka per tab diambil dari stats (menghitung
             * SELURUH PR), supaya jelas berapa yang sebenarnya ada sebelum
             * daftarnya dimuat. */
            const tabCount =
              f.key === "all"
                ? (stats?.openCount ?? 0) +
                  (stats?.partialCount ?? 0) +
                  (stats?.completedCount ?? 0) +
                  (stats?.cancelledCount ?? 0)
                : f.key === "open"
                  ? stats?.openCount
                  : f.key === "partial"
                    ? stats?.partialCount
                    : f.key === "completed"
                      ? stats?.completedCount
                      : stats?.cancelledCount;
            return (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => {
                setFilter(f.key);
                setPageSize(PAGE_SIZE);
              }}
              className={cn(
                "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                filter === f.key
                  ? "border-mahakan-green-700 text-mahakan-green-900"
                  : "border-transparent text-neutral-500 hover:text-neutral-900",
              )}
            >
              {f.label}
              {typeof tabCount === "number" ? (
                <span
                  className={cn(
                    "ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                    filter === f.key
                      ? "bg-mahakan-green-700 text-white"
                      : "bg-neutral-100 text-neutral-500",
                  )}
                >
                  {tabCount}
                </span>
              ) : null}
            </button>
            );
          })}
        </div>
        {/* Sesi AE-122 — sort toggle. Default newest first (terbaru atas). */}
        <div className="flex items-center gap-1 pb-2">
          <ArrowDownUp className="size-3.5 text-neutral-400" aria-hidden />
          <div className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setSortOrder("newest")}
              className={cn(
                "rounded px-2 py-1 font-medium transition-colors",
                sortOrder === "newest"
                  ? "bg-mahakan-green-700 text-white"
                  : "text-neutral-600 hover:text-neutral-900",
              )}
              aria-pressed={sortOrder === "newest"}
              title="Terbaru di atas"
            >
              Terbaru
            </button>
            <button
              type="button"
              onClick={() => setSortOrder("oldest")}
              className={cn(
                "rounded px-2 py-1 font-medium transition-colors",
                sortOrder === "oldest"
                  ? "bg-mahakan-green-700 text-white"
                  : "text-neutral-600 hover:text-neutral-900",
              )}
              aria-pressed={sortOrder === "oldest"}
              title="Terlama di atas (FIFO)"
            >
              Terlama
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="size-8 text-mahakan-green-700" />
        </div>
      ) : error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}
        </div>
      ) : requests.length === 0 ? (
        <EmptyCard
          icon={ClipboardList}
          title="Belum ada permintaan"
          description="Kasir belum membuat permintaan belanja untuk filter ini."
        />
      ) : (
        <div className="space-y-2">
          {requests.map((req) => (
            <RequestCard
              key={req.id}
              request={req}
              onShowDetail={(r) => setDetailRequest(r)}
            />
          ))}

          {/* Sesi AE-197 — SELALU tampilkan berapa yang terlihat dari total.
              Sebelumnya daftar berhenti di 50 tanpa jejak apa pun, sehingga
              101 PR hilang diam-diam dari layar. */}
          <div className="flex flex-col items-center gap-2 pt-3">
            <p className="text-xs text-neutral-500">
              Menampilkan {requests.length} dari {totalCount} permintaan
            </p>
            {hasMore ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPageSize((n) => n + PAGE_SIZE)}
                disabled={isFetching}
              >
                {isFetching
                  ? "Memuat…"
                  : `Muat ${Math.min(PAGE_SIZE, totalCount - requests.length)} lagi`}
              </Button>
            ) : null}
          </div>
        </div>
      )}

      {/* Sesi AE-19 — Reject single item modal */}
      <Modal
        open={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        title="Tolak Item"
        description={
          rejectTarget
            ? `${rejectTarget.item.ingredientNameSnapshot} — ${Number(rejectTarget.item.requestedQty)} ${rejectTarget.item.unitSnapshot}`
            : undefined
        }
        size="md"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setRejectTarget(null)}
              disabled={rejectSubmitting}
            >
              Batal
            </Button>
            <Button
              onClick={submitReject}
              disabled={rejectSubmitting || rejectReason.trim().length < 3}
              className="!bg-danger-500 hover:!bg-danger-600"
            >
              {rejectSubmitting ? "Memproses…" : "Tolak Item"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-neutral-600">
            Item yang di-reject akan dikecualikan dari hitungan pemenuhan PR
            (item lain tetap bisa di-terima). Status PR auto-recompute. Kalau
            SEMUA item di-reject, PR otomatis di-cancel.
          </p>
          <div className="flex flex-wrap gap-1">
            {[
              "Supplier kosong",
              "Harga terlalu mahal",
              "Sudah ada di gudang",
              "Salah input dari kasir",
            ].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() =>
                  setRejectReason((prev) =>
                    prev.trim().length === 0
                      ? t
                      : `${prev.trim()} — ${t}`,
                  )
                }
                disabled={rejectSubmitting}
                className="rounded-full border border-danger-300 bg-danger-50 px-2.5 py-1 text-[11px] font-medium text-danger-700 transition-colors hover:bg-danger-100 disabled:opacity-50"
              >
                + {t}
              </button>
            ))}
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-900">
              Alasan Tolak <span className="text-danger-500">*</span>
            </label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value.slice(0, 300))}
              rows={3}
              placeholder="Mis: supplier ga punya stok hari ini"
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger-500"
              disabled={rejectSubmitting}
            />
            <p
              className={cn(
                "mt-1 text-[11px]",
                rejectReason.trim().length < 3
                  ? "text-danger-700"
                  : "text-neutral-500",
              )}
            >
              {rejectReason.trim().length < 3
                ? "Minimal 3 karakter"
                : "Alasan terisi"}
            </p>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        title="Batalkan Permintaan Belanja"
        size="md"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setCancelTarget(null)}
              disabled={cancelSubmitting}
            >
              Tidak
            </Button>
            <Button
              variant="destructive"
              onClick={submitCancel}
              disabled={cancelSubmitting}
            >
              {cancelSubmitting ? "Membatalkan..." : "Ya, Batalkan"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-neutral-700">
            Permintaan akan ditandai dibatalkan. Item yang sudah diterima
            sebagian tetap tersimpan sebagai catatan.
          </p>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Alasan
            </label>
            <Input
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Mis. duplikat, sudah dibeli langsung"
            />
          </div>
        </div>
      </Modal>

      {/* Feedback Anisa 2026-06-08 — konfirmasi Tandai Selesai manual */}
      <Modal
        open={!!completeTarget}
        onClose={() => setCompleteTarget(null)}
        title="Tandai PR Selesai?"
        size="md"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setCompleteTarget(null)}
              disabled={completeSubmitting}
            >
              Batal
            </Button>
            <Button onClick={submitComplete} disabled={completeSubmitting}>
              {completeSubmitting ? "Menyimpan..." : "Ya, Tandai Selesai"}
            </Button>
          </>
        }
      >
        {completeTarget
          ? (() => {
              const active = completeTarget.items.filter((i) => !i.rejectedAt);
              /* Feedback Cacil 2026-06-12 — bedakan "belum diproses" vs
               * "sudah dalam PO (menunggu diterima)" pakai definisi bucket
               * yang sama dengan detail modal. */
              const unprocessed = active.filter(
                (i) =>
                  categorizePrItem({
                    receivedQty: Number(i.receivedQty),
                    rejectedAt: i.rejectedAt,
                    inActivePurchase: i.inActivePurchase,
                  }) === "outstanding",
              );
              const inPo = active.filter(
                (i) =>
                  categorizePrItem({
                    receivedQty: Number(i.receivedQty),
                    rejectedAt: i.rejectedAt,
                    inActivePurchase: i.inActivePurchase,
                  }) === "ordered",
              );
              const under = active.filter(
                (i) =>
                  Number(i.receivedQty) > 0 &&
                  Number(i.receivedQty) < Number(i.requestedQty),
              );
              return (
                <div className="space-y-3 text-sm text-neutral-700">
                  <p>
                    PR akan ditutup sebagai <strong>Selesai</strong>. Cocok kalau
                    kamu sudah selesai memproses PR ini—walau ada item yang
                    sengaja dibeli lebih sedikit atau tidak jadi dibeli.
                  </p>
                  {unprocessed.length > 0 ? (
                    <div className="rounded-md border border-warning-300 bg-warning-100/40 p-3">
                      <p className="mb-1 text-xs font-semibold text-warning-600">
                        {unprocessed.length} item belum diproses sama sekali:
                      </p>
                      <p className="text-xs text-neutral-700">
                        {unprocessed
                          .map((i) => i.ingredientNameSnapshot)
                          .join(", ")}
                      </p>
                    </div>
                  ) : null}
                  {inPo.length > 0 ? (
                    <p className="text-xs text-neutral-500">
                      {inPo.length} item sedang dalam PO (penerimaannya tetap
                      tercatat walau PR sudah Selesai).
                    </p>
                  ) : null}
                  {under.length > 0 ? (
                    <p className="text-xs text-neutral-500">
                      {under.length} item dibeli kurang dari request (dianggap
                      keputusan final).
                    </p>
                  ) : null}
                  <p className="text-xs text-neutral-500">
                    Catatan: tanggal PR/pembelian/penerimaan boleh berbeda—tidak
                    memengaruhi status.
                  </p>
                </div>
              );
            })()
          : null}
      </Modal>

      {/* Sesi AE-57 — PR detail modal (replaces inline card items) */}
      <PurchaseRequestDetailModal
        request={detailRequest}
        onClose={() => setDetailRequest(null)}
        onRejectItem={(item) => {
          setDetailRequest(null);
          openReject(item);
        }}
        onCancel={(r) => {
          setDetailRequest(null);
          setCancelTarget(r);
          setCancelReason("");
        }}
        onPullToPurchase={(r) => {
          setDetailRequest(null);
          setPullPrId(r.id);
        }}
        onMarkComplete={(r) => {
          setDetailRequest(null);
          setCompleteTarget(r);
        }}
      />

      {/* Sesi AE-57 — Tarik dari PR wizard (pre-fill PR yang dipilih) */}
      <CreatePurchaseFromPrModal
        open={pullPrId !== null}
        prefilledPrId={pullPrId}
        onClose={() => setPullPrId(null)}
        onSaved={() => {
          setPullPrId(null);
          void refresh();
        }}
      />
    </div>
  );
}

interface RequestCardProps {
  request: PurchaseRequestWithItems;
  onShowDetail: (r: PurchaseRequestWithItems) => void;
}

/* Sesi AE-57 — RequestCard sekarang summary-only.
 * Items table di-pindah ke PurchaseRequestDetailModal yang dibuka via
 * "Lihat Detail" / klik card. Owner request: list compact biar gampang
 * scan saat ada banyak PR. */
function RequestCard({ request, onShowDetail }: RequestCardProps) {
  /* Sesi AE-177 — basis ITEM (bukan jumlah qty lintas satuan).
   * Feedback Anisa 2026-06-08: "dibeli" = dapat ≥1 unit (qty kurang OK).
   * Feedback Cacil 2026-06-12: item yang sudah DITARIK ke PO aktif (menunggu
   * diterima) bukan lagi "belum dibeli" — pakai categorizePrItem (definisi
   * sama dgn detail modal + Tarik ke Pembelian). */
  const activeItems = request.items.filter((i) => !i.rejectedAt);
  const boughtItemCount = activeItems.filter(
    (i) => Number(i.receivedQty) > 0,
  ).length;
  const fulfillPercent =
    activeItems.length > 0
      ? Math.round((boughtItemCount / activeItems.length) * 100)
      : 0;
  const buckets = request.items.map((i) =>
    categorizePrItem({
      receivedQty: Number(i.receivedQty),
      rejectedAt: i.rejectedAt,
      inActivePurchase: i.inActivePurchase,
    }),
  );
  const outstandingItemCount = buckets.filter(
    (b) => b === "outstanding",
  ).length;
  const orderedItemCount = buckets.filter((b) => b === "ordered").length;
  /* Sesi AE-197 — PR yang sudah DITUTUP tapi masih menyisakan bahan yang tidak
   * pernah dibeli. Kalau tidak ditandai, permintaan itu lenyap begitu saja:
   * statusnya "Selesai"/"Dibatalkan" sehingga tidak muncul di daftar kerja,
   * padahal bahannya belum pernah masuk. Di produksi ada 12 item seperti ini
   * di 9 PR yang di-Tandai Selesai, plus 230 item di PR yang dibatalkan. */
  const closedWithUnbought =
    (request.status === "completed" || request.status === "cancelled") &&
    outstandingItemCount > 0;
  return (
    <Card
      className="cursor-pointer transition-colors hover:border-mahakan-green-700 hover:shadow-sm"
      onClick={() => onShowDetail(request)}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 px-5 py-3">
        <div className="space-y-1">
          <CardTitle className="text-sm">
            {formatRequestLabel(request)}
          </CardTitle>
          <p className="text-xs text-neutral-600">
            {request.createdByName ?? "—"} ·{" "}
            {request.createdAt.toLocaleString("id-ID", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={STATUS_VARIANT[request.status]}>
            {STATUS_LABEL[request.status]}
          </Badge>
          {closedWithUnbought ? (
            <Badge
              variant="warning"
              title={`PR ditutup dengan status "${STATUS_LABEL[request.status]}", tapi ${outstandingItemCount} bahan di dalamnya tidak pernah dibeli.`}
            >
              <AlertTriangle className="mr-1 size-3" aria-hidden />
              {outstandingItemCount} bahan tak jadi dibeli
            </Badge>
          ) : null}
          {request.whatsappSentAt ? (
            <p className="flex items-center gap-1 text-[10px] text-neutral-400">
              <MessageCircle className="size-3" /> WA dikirim
            </p>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-3 pt-0">
        {/* Summary row: item count + qty + progress bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-700">
          <div className="flex items-center gap-3">
            <span>
              <Package className="mr-1 inline size-3.5 text-neutral-500" />
              {request.items.length} bahan
              {outstandingItemCount > 0 ? (
                <span className="ml-1 text-warning-500">
                  ({outstandingItemCount} belum diproses)
                </span>
              ) : null}
              {orderedItemCount > 0 ? (
                <span className="ml-1 text-info-500">
                  ({orderedItemCount} dalam PO)
                </span>
              ) : null}
            </span>
            <span className="font-mono">
              {boughtItemCount} / {activeItems.length} item
            </span>
          </div>
          {activeItems.length > 0 ? (
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-semibold">
                {fulfillPercent}%
              </span>
              <div className="h-1.5 w-32 overflow-hidden rounded-full bg-neutral-100">
                <div
                  className={cn(
                    "h-full transition-all",
                    fulfillPercent === 100
                      ? "bg-mahakan-green-700"
                      : fulfillPercent > 0
                        ? "bg-info-400"
                        : "bg-warning-400",
                  )}
                  style={{ width: `${Math.min(100, fulfillPercent)}%` }}
                />
              </div>
            </div>
          ) : null}
        </div>
        {request.notes ? (
          <p className="mt-2 line-clamp-1 text-[11px] italic text-neutral-500">
            Catatan: {request.notes}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function formatRequestLabel(request: PurchaseRequestWithItems): string {
  if (request.shiftStartedAt) {
    return `Shift ${request.shiftStartedAt.toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })}`;
  }
  return `Permintaan ${request.createdAt.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })}`;
}

// ============================================================
// Sesi AE-15 — PR stats card
// ============================================================

function PrStatCard({
  Icon,
  label,
  value,
  sub,
  accent,
}: {
  Icon: typeof ClipboardList;
  label: string;
  value: string;
  sub: string;
  accent: "default" | "warning" | "danger" | "success";
}) {
  const accentClasses = {
    default: "border-neutral-200 bg-white",
    warning: "border-warning-300 bg-warning-100",
    danger: "border-danger-300 bg-danger-100",
    success: "border-mahakan-green-200 bg-mahakan-green-50",
  }[accent];
  const iconColor = {
    default: "text-neutral-500",
    warning: "text-warning-500",
    danger: "text-danger-500",
    success: "text-mahakan-green-700",
  }[accent];
  return (
    <div className={cn("rounded-xl border p-4", accentClasses)}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-600">
        <Icon className={cn("size-4", iconColor)} aria-hidden />
        {label}
      </div>
      <div className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-neutral-900">
        {value}
      </div>
      <p className="mt-0.5 text-[11px] text-neutral-600">{sub}</p>
    </div>
  );
}
