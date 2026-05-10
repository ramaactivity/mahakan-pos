"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCheck,
  CheckCircle2,
  ClipboardList,
  MessageCircle,
  Package,
  TrendingUp,
  X,
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
  NumericInput,
  ResponsiveTable,
  Spinner,
  toast,
  type ResponsiveColumn,
} from "@/components/ui";
import {
  bulkReceiveItems,
  cancelPurchaseRequest,
  getPurchaseRequestStats,
  listPurchaseRequests,
  receiveItem,
} from "@/features/purchase-requests/actions";
import {
  isOk,
  type PurchaseRequestItem,
  type PurchaseRequestStatus,
  type PurchaseRequestWithItems,
} from "@/features/purchase-requests/types";
import { cn } from "@/lib/utils";

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

export function PurchaseRequestsSection() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterTab>("open");

  const [receiveTarget, setReceiveTarget] = useState<{
    item: PurchaseRequestItem;
    requestStatus: PurchaseRequestStatus;
  } | null>(null);
  const [receiveQty, setReceiveQty] = useState("0");
  const [receiveSubmitting, setReceiveSubmitting] = useState(false);

  const [cancelTarget, setCancelTarget] = useState<PurchaseRequestWithItems | null>(
    null,
  );
  const [cancelReason, setCancelReason] = useState("");
  const [cancelSubmitting, setCancelSubmitting] = useState(false);

  // Sesi AE-18 — bulk receive state.
  const [bulkTarget, setBulkTarget] =
    useState<PurchaseRequestWithItems | null>(null);
  const [bulkQtys, setBulkQtys] = useState<Record<string, string>>({});
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const {
    data: requests = [],
    isLoading: loading,
    error: queryError,
  } = useQuery({
    queryKey: ["admin", "purchase-requests", { filter }],
    queryFn: async () => {
      const res = await listPurchaseRequests({ status: filter, limit: 50 });
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });
  const error =
    queryError instanceof Error ? queryError.message : null;

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

  function openReceive(
    item: PurchaseRequestItem,
    requestStatus: PurchaseRequestStatus,
  ) {
    setReceiveTarget({ item, requestStatus });
    const remaining = Number(item.requestedQty) - Number(item.receivedQty);
    setReceiveQty(String(remaining > 0 ? remaining : 0));
  }

  async function submitReceive() {
    if (!receiveTarget) return;
    const qty = parseInt(receiveQty, 10);
    if (!Number.isFinite(qty) || qty < 0) {
      toast.error("Qty tidak valid");
      return;
    }
    const totalAfter = qty;
    if (totalAfter > Number(receiveTarget.item.requestedQty)) {
      toast.error("Qty melebihi qty diminta");
      return;
    }
    setReceiveSubmitting(true);
    const res = await receiveItem({
      itemId: receiveTarget.item.id,
      receivedQty: totalAfter,
    });
    setReceiveSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      res.data.newStatus === "completed"
        ? "Selesai diterima"
        : "Qty diterima diperbarui",
    );
    setReceiveTarget(null);
    void refresh();
  }

  function openBulk(req: PurchaseRequestWithItems) {
    setBulkTarget(req);
    // Pre-fill with sisa untuk full fulfill.
    const initial: Record<string, string> = {};
    for (const it of req.items) {
      const sisa = Number(it.requestedQty) - Number(it.receivedQty);
      const target = sisa > 0 ? Number(it.requestedQty) : Number(it.receivedQty);
      initial[it.id] = String(target);
    }
    setBulkQtys(initial);
  }

  function bulkFillAll() {
    if (!bulkTarget) return;
    const next: Record<string, string> = {};
    for (const it of bulkTarget.items) {
      next[it.id] = String(Number(it.requestedQty));
    }
    setBulkQtys(next);
  }

  function bulkResetReceived() {
    if (!bulkTarget) return;
    const next: Record<string, string> = {};
    for (const it of bulkTarget.items) {
      next[it.id] = String(Number(it.receivedQty));
    }
    setBulkQtys(next);
  }

  async function submitBulk() {
    if (!bulkTarget) return;
    const items: Array<{ itemId: string; receivedQty: number }> = [];
    for (const it of bulkTarget.items) {
      const raw = bulkQtys[it.id] ?? "0";
      const n = parseFloat(raw.replace(",", "."));
      if (!Number.isFinite(n) || n < 0) {
        toast.error(`Qty tidak valid untuk ${it.ingredientNameSnapshot}`);
        return;
      }
      if (n > Number(it.requestedQty)) {
        toast.error(
          `${it.ingredientNameSnapshot}: qty melebihi yang diminta`,
        );
        return;
      }
      items.push({ itemId: it.id, receivedQty: n });
    }
    setBulkSubmitting(true);
    const res = await bulkReceiveItems({
      requestId: bulkTarget.id,
      items,
    });
    setBulkSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      `${res.data.itemsUpdated} item ter-update · status: ${
        res.data.newStatus === "completed"
          ? "Selesai"
          : res.data.newStatus === "partial"
            ? "Sebagian"
            : "Open"
      }`,
    );
    setBulkTarget(null);
    setBulkQtys({});
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

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-mahakan-green-900">
            <ClipboardList className="size-6" aria-hidden /> Permintaan
            Belanja
          </h1>
          <p className="text-sm text-neutral-700">
            Permintaan belanja dari kasir/staff. Ikuti alur:
            <strong> Open</strong> → terima sebagian (
            <strong>Sebagian</strong>) → semua diterima (
            <strong>Selesai</strong>). Klik <strong>Terima Banyak</strong>{" "}
            untuk update banyak item sekaligus.
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
              stats.pendingItemsTotal > 0
                ? `${stats.pendingItemsTotal} item belum diterima`
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

      <div
        role="tablist"
        aria-label="Filter status"
        className="flex flex-wrap gap-1 border-b border-neutral-200"
      >
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
              filter === f.key
                ? "border-mahakan-green-700 text-mahakan-green-900"
                : "border-transparent text-neutral-500 hover:text-neutral-900",
            )}
          >
            {f.label}
          </button>
        ))}
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
        <div className="space-y-3">
          {requests.map((req) => (
            <RequestCard
              key={req.id}
              request={req}
              onReceive={openReceive}
              onBulkReceive={openBulk}
              onCancel={(r) => {
                setCancelTarget(r);
                setCancelReason("");
              }}
            />
          ))}
        </div>
      )}

      <Modal
        open={!!receiveTarget}
        onClose={() => setReceiveTarget(null)}
        title="Terima Barang"
        size="md"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setReceiveTarget(null)}
              disabled={receiveSubmitting}
            >
              Batal
            </Button>
            <Button onClick={submitReceive} disabled={receiveSubmitting}>
              {receiveSubmitting ? "Menyimpan..." : "Simpan"}
            </Button>
          </>
        }
      >
        {receiveTarget ? (
          <div className="space-y-3">
            <div>
              <p className="text-sm text-neutral-600">Bahan</p>
              <p className="text-base font-medium text-neutral-900">
                {receiveTarget.item.ingredientNameSnapshot}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-neutral-600">Diminta</p>
                <p className="font-medium text-neutral-900">
                  {Number(receiveTarget.item.requestedQty).toLocaleString(
                    "id-ID",
                  )}{" "}
                  {receiveTarget.item.unitSnapshot}
                </p>
              </div>
              <div>
                <p className="text-neutral-600">Sebelumnya</p>
                <p className="font-medium text-neutral-900">
                  {Number(receiveTarget.item.receivedQty).toLocaleString(
                    "id-ID",
                  )}{" "}
                  {receiveTarget.item.unitSnapshot}
                </p>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">
                Total qty diterima ({receiveTarget.item.unitSnapshot})
              </label>
              <NumericInput
                value={receiveQty}
                onChange={setReceiveQty}
                allowDecimal={false}
              />
              <p className="mt-1 text-xs text-neutral-600">
                Isi total qty kumulatif (bukan tambahan). Maks{" "}
                {Number(receiveTarget.item.requestedQty).toLocaleString(
                  "id-ID",
                )}
                .
              </p>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Sesi AE-18 — Bulk Receive Modal */}
      <Modal
        open={!!bulkTarget}
        onClose={() => setBulkTarget(null)}
        title="Terima Banyak Item Sekaligus"
        description={
          bulkTarget
            ? `${bulkTarget.items.length} item dari ${formatRequestLabel(bulkTarget)}`
            : undefined
        }
        size="2xl"
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={bulkFillAll}
                disabled={bulkSubmitting}
              >
                <CheckCheck className="size-4" /> Penuhi Semua
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={bulkResetReceived}
                disabled={bulkSubmitting}
              >
                Reset
              </Button>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setBulkTarget(null)}
                disabled={bulkSubmitting}
              >
                Batal
              </Button>
              <Button onClick={submitBulk} disabled={bulkSubmitting}>
                {bulkSubmitting ? "Menyimpan…" : "Simpan Semua"}
              </Button>
            </div>
          </div>
        }
      >
        {bulkTarget ? (
          <div className="space-y-3">
            <p className="text-xs text-neutral-600">
              Edit qty diterima per item. Klik <strong>Penuhi Semua</strong>{" "}
              untuk auto-fill ke qty yang diminta. Status PR auto-update
              setelah simpan (Open → Sebagian → Selesai).
            </p>
            <div className="overflow-x-auto rounded-md border border-neutral-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-xs text-neutral-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Bahan</th>
                    <th className="px-3 py-2 text-right font-medium">Diminta</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Sudah Diterima
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Total Diterima
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {bulkTarget.items.map((it) => {
                    const requested = Number(it.requestedQty);
                    const previousReceived = Number(it.receivedQty);
                    const sisa = Math.max(0, requested - previousReceived);
                    const currentVal = bulkQtys[it.id] ?? "0";
                    const parsedCurrent = parseFloat(
                      currentVal.replace(",", "."),
                    );
                    const isFulfilled =
                      Number.isFinite(parsedCurrent) &&
                      parsedCurrent >= requested;
                    return (
                      <tr key={it.id}>
                        <td className="px-3 py-2">
                          <p className="font-medium text-neutral-900">
                            {it.ingredientNameSnapshot}
                          </p>
                          <p className="text-[11px] text-neutral-500">
                            {it.unitSnapshot}
                            {sisa > 0 ? ` · sisa ${sisa}` : " · sudah penuh"}
                            {it.notes ? ` · ${it.notes}` : ""}
                          </p>
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {requested.toLocaleString("id-ID")}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-neutral-600">
                          {previousReceived.toLocaleString("id-ID")}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={currentVal}
                            onChange={(e) =>
                              setBulkQtys((prev) => ({
                                ...prev,
                                [it.id]: e.target.value,
                              }))
                            }
                            className={cn(
                              "h-9 w-24 rounded-md border bg-white px-2 text-right font-mono text-sm tabular-nums",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700/40 focus-visible:border-mahakan-green-700",
                              isFulfilled
                                ? "border-mahakan-green-700 text-mahakan-green-900"
                                : parsedCurrent > 0
                                  ? "border-warning-500 text-warning-700"
                                  : "border-neutral-300 text-neutral-900",
                            )}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
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
    </div>
  );
}

interface RequestCardProps {
  request: PurchaseRequestWithItems;
  onReceive: (
    item: PurchaseRequestItem,
    requestStatus: PurchaseRequestStatus,
  ) => void;
  onBulkReceive: (r: PurchaseRequestWithItems) => void;
  onCancel: (r: PurchaseRequestWithItems) => void;
}

function RequestCard({
  request,
  onReceive,
  onBulkReceive,
  onCancel,
}: RequestCardProps) {
  const canEdit =
    request.status !== "cancelled" && request.status !== "completed";
  const totalRequested = request.items.reduce(
    (sum, i) => sum + Number(i.requestedQty),
    0,
  );
  const totalReceived = request.items.reduce(
    (sum, i) => sum + Number(i.receivedQty),
    0,
  );
  const fulfillPercent =
    totalRequested > 0
      ? Math.round((totalReceived / totalRequested) * 100)
      : 0;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 px-6 py-4">
        <div className="space-y-1">
          <CardTitle className="text-base">
            {formatRequestLabel(request)}
          </CardTitle>
          <p className="text-xs text-neutral-600">
            Dibuat oleh {request.createdByName ?? "—"} ·{" "}
            {request.createdAt.toLocaleString("id-ID", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
          {request.notes ? (
            <p className="text-xs text-neutral-700">Catatan: {request.notes}</p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={STATUS_VARIANT[request.status]}>
            {STATUS_LABEL[request.status]}
          </Badge>
          <p className="text-xs text-neutral-600">
            {totalReceived.toLocaleString("id-ID")} /{" "}
            {totalRequested.toLocaleString("id-ID")}
          </p>
          {request.whatsappSentAt ? (
            <p className="flex items-center gap-1 text-[10px] text-neutral-400">
              <MessageCircle className="size-3" /> WA dikirim
            </p>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="px-6 pb-4 pt-0">
        {/* Sesi AE-18 — fulfillment progress bar */}
        {totalRequested > 0 ? (
          <div className="mb-3 space-y-1">
            <div className="flex items-center justify-between text-xs text-neutral-600">
              <span>Pemenuhan</span>
              <span className="font-mono font-semibold">
                {fulfillPercent}% ({totalReceived.toLocaleString("id-ID")}/
                {totalRequested.toLocaleString("id-ID")})
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
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
        <ResponsiveTable<PurchaseRequestItem>
          rows={request.items}
          rowKey={(it) => it.id}
          columns={purchaseRequestItemColumns()}
          rowActions={
            canEdit
              ? (it) => {
                  const remaining =
                    Number(it.requestedQty) - Number(it.receivedQty);
                  const itemDone = remaining === 0;
                  return (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onReceive(it, request.status)}
                    >
                      {itemDone ? "Edit" : "Terima"}
                    </Button>
                  );
                }
              : undefined
          }
        />
      </CardContent>
      {canEdit ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-100 px-6 py-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onCancel(request)}
          >
            <X className="size-4" /> Batalkan
          </Button>
          {/* Sesi AE-18 — bulk receive shortcut. */}
          <Button
            size="sm"
            onClick={() => onBulkReceive(request)}
          >
            <CheckCheck className="size-4" /> Terima Banyak
          </Button>
        </div>
      ) : request.status === "cancelled" && request.cancelReason ? (
        <div className="border-t border-neutral-100 px-6 py-3 text-xs text-neutral-600">
          <span className="font-medium">Alasan batal:</span>{" "}
          {request.cancelReason}
          {request.cancelledByName ? (
            <span> · oleh {request.cancelledByName}</span>
          ) : null}
        </div>
      ) : null}
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

function purchaseRequestItemColumns(): ResponsiveColumn<PurchaseRequestItem>[] {
  return [
    {
      key: "ingredient",
      label: "Bahan",
      primary: true,
      render: (it) => (
        <div>
          <p className="font-medium text-neutral-900">
            {it.ingredientNameSnapshot}
          </p>
          {it.notes ? (
            <p className="text-xs text-neutral-600">{it.notes}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: "requested",
      label: "Diminta",
      align: "right",
      render: (it) => (
        <span>
          {Number(it.requestedQty).toLocaleString("id-ID")}{" "}
          <span className="text-xs text-neutral-500">{it.unitSnapshot}</span>
        </span>
      ),
    },
    {
      key: "received",
      label: "Diterima",
      align: "right",
      render: (it) => Number(it.receivedQty).toLocaleString("id-ID"),
    },
    {
      key: "remaining",
      label: "Sisa",
      align: "right",
      render: (it) => {
        const remaining = Number(it.requestedQty) - Number(it.receivedQty);
        const itemDone = remaining === 0;
        return (
          <span
            className={cn(
              itemDone
                ? "text-emerald-700"
                : remaining > 0
                  ? "text-amber-700"
                  : "text-neutral-900",
            )}
          >
            {remaining.toLocaleString("id-ID")}
          </span>
        );
      },
    },
  ];
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
