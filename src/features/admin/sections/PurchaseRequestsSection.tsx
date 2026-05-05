"use client";

import { useEffect, useState } from "react";
import { ClipboardList, MessageCircle, X } from "lucide-react";
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
  Spinner,
  toast,
} from "@/components/ui";
import {
  cancelPurchaseRequest,
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
  const [filter, setFilter] = useState<FilterTab>("open");
  const [requests, setRequests] = useState<PurchaseRequestWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

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

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      try {
        const res = await listPurchaseRequests({
          status: filter,
          limit: 50,
        });
        if (cancelled) return;
        if (isOk(res)) setRequests(res.data);
        else setError(res.error.message);
      } catch (e) {
        if (cancelled) return;
        console.error("[PurchaseRequests] load failed", e);
        setError(
          e instanceof Error
            ? e.message
            : "Gagal memuat permintaan belanja",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, refreshKey]);

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
    setRefreshKey((k) => k + 1);
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
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-mahakan-green-900">
            Permintaan Belanja
          </h1>
          <p className="text-sm text-neutral-700">
            List belanja dari kasir saat tutup shift. Mark received per item
            untuk update status.
          </p>
        </div>
      </header>

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
              <p className="mt-1 text-xs text-neutral-500">
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
  onCancel: (r: PurchaseRequestWithItems) => void;
}

function RequestCard({ request, onReceive, onCancel }: RequestCardProps) {
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
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 px-6 py-4">
        <div className="space-y-1">
          <CardTitle className="text-base">
            {formatRequestLabel(request)}
          </CardTitle>
          <p className="text-xs text-neutral-500">
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
          <p className="text-xs text-neutral-500">
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
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="py-1.5 pr-2 font-medium">Bahan</th>
              <th className="py-1.5 px-2 text-right font-medium">Diminta</th>
              <th className="py-1.5 px-2 text-right font-medium">Diterima</th>
              <th className="py-1.5 px-2 text-right font-medium">Sisa</th>
              <th className="py-1.5 pl-2"></th>
            </tr>
          </thead>
          <tbody>
            {request.items.map((it) => {
              const remaining =
                Number(it.requestedQty) - Number(it.receivedQty);
              const itemDone = remaining === 0;
              return (
                <tr key={it.id} className="border-b border-neutral-100">
                  <td className="py-2 pr-2">
                    <p className="font-medium text-neutral-900">
                      {it.ingredientNameSnapshot}
                    </p>
                    {it.notes ? (
                      <p className="text-xs text-neutral-500">{it.notes}</p>
                    ) : null}
                  </td>
                  <td className="py-2 px-2 text-right text-neutral-900">
                    {Number(it.requestedQty).toLocaleString("id-ID")}{" "}
                    <span className="text-xs text-neutral-500">
                      {it.unitSnapshot}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right text-neutral-900">
                    {Number(it.receivedQty).toLocaleString("id-ID")}
                  </td>
                  <td
                    className={cn(
                      "py-2 px-2 text-right",
                      itemDone
                        ? "text-emerald-700"
                        : remaining > 0
                          ? "text-amber-700"
                          : "text-neutral-900",
                    )}
                  >
                    {remaining.toLocaleString("id-ID")}
                  </td>
                  <td className="py-2 pl-2 text-right">
                    {canEdit ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onReceive(it, request.status)}
                      >
                        {itemDone ? "Edit" : "Terima"}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
      {canEdit ? (
        <div className="flex justify-end gap-2 border-t border-neutral-100 px-6 py-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onCancel(request)}
          >
            <X className="size-4" /> Batalkan
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
