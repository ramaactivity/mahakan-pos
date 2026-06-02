"use client";

import {
  FileText,
  MessageCircle,
  Package,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Modal,
  ResponsiveTable,
  type ResponsiveColumn,
} from "@/components/ui";
import type {
  PurchaseRequestItem,
  PurchaseRequestStatus,
  PurchaseRequestWithItems,
} from "@/features/purchase-requests/types";
import { cn } from "@/lib/utils";

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

interface Props {
  request: PurchaseRequestWithItems | null;
  onClose: () => void;
  onRejectItem: (item: PurchaseRequestItem) => void;
  onCancel: (r: PurchaseRequestWithItems) => void;
  onPullToPurchase: (r: PurchaseRequestWithItems) => void;
}

export function PurchaseRequestDetailModal({
  request,
  onClose,
  onRejectItem,
  onCancel,
  onPullToPurchase,
}: Props) {
  if (!request) return null;

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
  const outstandingItemCount = request.items.filter(
    (i) => !i.rejectedAt && Number(i.receivedQty) < Number(i.requestedQty),
  ).length;

  return (
    <Modal
      open={request !== null}
      onClose={onClose}
      title={formatRequestLabel(request)}
      description={`Dibuat ${request.createdByName ?? "—"} · ${request.createdAt.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}`}
      size="xl"
    >
      <div className="space-y-4">
        {/* Status + meta header */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
          <div className="flex items-center gap-3">
            <Badge variant={STATUS_VARIANT[request.status]}>
              {STATUS_LABEL[request.status]}
            </Badge>
            <p className="text-xs text-neutral-600">
              <Package className="mr-1 inline size-3.5" />
              {request.items.length} bahan ·{" "}
              {totalRequested.toLocaleString("id-ID")} qty
            </p>
            {request.whatsappSentAt ? (
              <p className="flex items-center gap-1 text-[11px] text-neutral-500">
                <MessageCircle className="size-3" /> WA dikirim
              </p>
            ) : null}
          </div>
          <p className="font-mono text-xs text-neutral-700">
            {totalReceived.toLocaleString("id-ID")} /{" "}
            {totalRequested.toLocaleString("id-ID")} diterima
          </p>
        </div>

        {/* Fulfillment progress bar */}
        {totalRequested > 0 ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-neutral-600">
              <span>Pemenuhan</span>
              <span className="font-mono font-semibold">{fulfillPercent}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
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

        {/* Notes */}
        {request.notes ? (
          <div className="rounded-md border border-neutral-200 bg-white p-3 text-sm text-neutral-700">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Catatan
            </p>
            <p className="mt-1">{request.notes}</p>
          </div>
        ) : null}

        {/* Items table */}
        <ResponsiveTable<PurchaseRequestItem>
          rows={request.items}
          rowKey={(it) => it.id}
          columns={purchaseRequestItemColumns()}
          rowActions={
            canEdit
              ? (it) => {
                  if (it.rejectedAt) {
                    return (
                      <span className="inline-flex items-center gap-1 rounded-full bg-danger-100 px-2 py-0.5 text-[10px] font-semibold text-danger-500">
                        <X className="size-3" /> Rejected
                      </span>
                    );
                  }
                  const remaining =
                    Number(it.requestedQty) - Number(it.receivedQty);
                  const itemDone = remaining === 0;
                  return (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {/* Sesi AE-177 — PR = request-only. Terima barang lewat
                          Pembelian/GR. Sisa aksi per-item: Tolak. */}
                      {!itemDone ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onRejectItem(it)}
                          className="border-danger-300 text-danger-500 hover:bg-danger-50 hover:border-danger-400"
                          title="Tolak item ini"
                        >
                          <X className="size-4" />
                          Tolak
                        </Button>
                      ) : null}
                    </div>
                  );
                }
              : undefined
          }
        />

        {/* Cancel reason (kalau dibatalkan) */}
        {request.status === "cancelled" && request.cancelReason ? (
          <div className="rounded-md border border-danger-100 bg-danger-100/30 p-3 text-xs text-danger-500">
            <span className="font-semibold">Alasan batal:</span>{" "}
            {request.cancelReason}
            {request.cancelledByName ? (
              <span> · oleh {request.cancelledByName}</span>
            ) : null}
          </div>
        ) : null}

        {/* Footer aksi */}
        {canEdit ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-200 pt-3">
            <Button variant="ghost" size="sm" onClick={() => onCancel(request)}>
              <X className="size-4" /> Batalkan PR
            </Button>
            {outstandingItemCount > 0 ? (
              <Button size="sm" onClick={() => onPullToPurchase(request)}>
                <FileText className="size-4" />
                Tarik ke Pembelian
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
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
          {it.ingredientId == null ? (
            <p className="text-[10px] uppercase tracking-wider text-warning-600">
              Manual · belum link master
            </p>
          ) : null}
          {it.notes ? (
            <p className="text-xs text-neutral-600">{it.notes}</p>
          ) : null}
        </div>
      ),
    },
    /* Sesi AE-122 — dedicated UNIT/SATUAN column. Sebelumnya inline kecil
     * di kolom Diminta. Owner request: lebih prominent supaya jelas
     * unit yang di-request (mis. Pcs vs Kg). */
    {
      key: "unit",
      label: "Satuan",
      render: (it) => (
        <span className="inline-flex rounded-md bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-700">
          {it.unitSnapshot}
        </span>
      ),
    },
    {
      key: "requested",
      label: "Diminta",
      align: "right",
      render: (it) => (
        <span className="font-mono tabular-nums">
          {Number(it.requestedQty).toLocaleString("id-ID")}
        </span>
      ),
    },
    {
      key: "received",
      label: "Diterima",
      align: "right",
      render: (it) => (
        <span className="font-mono tabular-nums">
          {Number(it.receivedQty).toLocaleString("id-ID")}
        </span>
      ),
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
              "font-mono tabular-nums",
              itemDone
                ? "text-mahakan-green-700"
                : remaining > 0
                  ? "text-warning-500"
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
