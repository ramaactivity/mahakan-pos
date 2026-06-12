"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  MessageCircle,
  Package,
  ShoppingBag,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Modal,
  ResponsiveTable,
  type ResponsiveColumn,
} from "@/components/ui";
import {
  categorizePrItem,
  type PrItemBucket,
} from "@/features/purchase-requests/group-items-pure";
import type {
  PurchaseRequestItem,
  PurchaseRequestItemWithLink,
  PurchaseRequestStatus,
  PurchaseRequestWithItems,
} from "@/features/purchase-requests/types";
import { isOk, listPurchasesForPurchaseRequest } from "@/features/purchases";
import { formatRupiah } from "@/lib/format";
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
  onMarkComplete: (r: PurchaseRequestWithItems) => void;
}

export function PurchaseRequestDetailModal({
  request,
  onClose,
  onRejectItem,
  onCancel,
  onPullToPurchase,
  onMarkComplete,
}: Props) {
  /* Sesi AE-177 — cross-surface arah-balik: PO/pembelian yang dibuat dari PR
   * ini. enabled hanya saat modal terbuka. */
  const { data: linkedPos = [] } = useQuery({
    queryKey: ["admin", "pr-linked-pos", request?.id],
    queryFn: async () => {
      if (!request) return [];
      const res = await listPurchasesForPurchaseRequest(request.id);
      return isOk(res) ? res.data : [];
    },
    enabled: !!request,
    staleTime: 30 * 1000,
  });

  /* Feedback Cacil 2026-06-12 — toggle section "Sudah diproses". Keyed ke
   * request.id primitif (BUKAN object identity — pitfall form-reset wipe):
   * default collapse selama masih ada item belum diproses, expand kalau
   * semuanya sudah diproses (mis. PR Selesai). */
  const [processedToggle, setProcessedToggle] = useState<{
    id: string;
    open: boolean;
  } | null>(null);

  if (!request) return null;

  const canEdit =
    request.status !== "cancelled" && request.status !== "completed";
  /* Feedback Cacil 2026-06-12 — item dipecah per bucket (1 definisi dengan
   * server/Tarik ke Pembelian via categorizePrItem):
   *  - outstanding : belum diproses sama sekali → tabel utama + bisa Tolak/Tarik
   *  - ordered     : sudah ditarik ke PO aktif, menunggu diterima
   *  - bought      : sudah dibeli/diterima ≥1 unit (qty kurang = final owner)
   *  - rejected    : ditolak
   * Bucket selain outstanding masuk section "Sudah diproses" (collapsed). */
  const bucketOf = new Map<string, PrItemBucket>(
    request.items.map((it) => [
      it.id,
      categorizePrItem({
        receivedQty: Number(it.receivedQty),
        rejectedAt: it.rejectedAt,
        inActivePurchase: it.inActivePurchase,
      }),
    ]),
  );
  const outstandingItems = request.items.filter(
    (it) => bucketOf.get(it.id) === "outstanding",
  );
  const processedItems = request.items.filter(
    (it) => bucketOf.get(it.id) !== "outstanding",
  );
  const orderedCount = request.items.filter(
    (it) => bucketOf.get(it.id) === "ordered",
  ).length;

  const activeItems = request.items.filter((i) => !i.rejectedAt);
  const boughtItemCount = activeItems.filter(
    (i) => Number(i.receivedQty) > 0,
  ).length;
  const fulfillPercent =
    activeItems.length > 0
      ? Math.round((boughtItemCount / activeItems.length) * 100)
      : 0;

  const processedOpen =
    processedToggle?.id === request.id
      ? processedToggle.open
      : outstandingItems.length === 0;

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
              {request.items.length} bahan
              {outstandingItems.length > 0 ? (
                <span className="text-warning-600">
                  {" "}
                  · {outstandingItems.length} belum diproses
                </span>
              ) : null}
              {orderedCount > 0 ? (
                <span className="text-info-500">
                  {" "}
                  · {orderedCount} dalam PO
                </span>
              ) : null}
            </p>
            {request.whatsappSentAt ? (
              <p className="flex items-center gap-1 text-[11px] text-neutral-500">
                <MessageCircle className="size-3" /> WA dikirim
              </p>
            ) : null}
          </div>
          <p className="font-mono text-xs text-neutral-700">
            {boughtItemCount} / {activeItems.length} item dibeli
          </p>
        </div>

        {/* Fulfillment progress bar */}
        {activeItems.length > 0 ? (
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

        {/* Sesi AE-177 — Pembelian terkait (link arah-balik PR→PO). */}
        {linkedPos.length > 0 ? (
          <div className="rounded-md border border-mahakan-green-200 bg-mahakan-green-50/50 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-mahakan-green-900">
              <ShoppingBag className="size-3.5" /> Sudah diproses jadi Pembelian
              / PO ({linkedPos.length})
            </p>
            <ul className="space-y-1">
              {linkedPos.map((po) => (
                <li
                  key={po.id}
                  className="flex items-center justify-between gap-2 text-xs text-neutral-700"
                >
                  <span className="font-mono">
                    PO #{po.id.slice(0, 8)}
                    {po.invoiceNo ? ` · ${po.invoiceNo}` : ""} ·{" "}
                    {po.supplierName ?? "Direct"} · {po.purchaseDate}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <Badge
                      variant={
                        po.receiptStatus === "received"
                          ? "success"
                          : po.receiptStatus === "cancelled"
                            ? "neutral"
                            : "warning"
                      }
                    >
                      {po.receiptStatus === "received"
                        ? "Diterima"
                        : po.receiptStatus === "partial"
                          ? "Sebagian"
                          : po.receiptStatus === "cancelled"
                            ? "Batal"
                            : "Belum diterima"}
                    </Badge>
                    <span className="font-mono text-neutral-600">
                      {formatRupiah(po.totalAmount)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
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

        {/* Feedback Cacil 2026-06-12 — tabel utama = HANYA item yang belum
            diproses. Item yang sudah dibeli/ditarik/ditolak pindah ke section
            "Sudah diproses" di bawah (collapsed) supaya tidak terbaca sebagai
            item yang masih harus dibeli. */}
        {outstandingItems.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-warning-600">
              Belum diproses ({outstandingItems.length} item)
            </p>
            <ResponsiveTable<PurchaseRequestItemWithLink>
              rows={outstandingItems}
              rowKey={(it) => it.id}
              columns={outstandingColumns()}
              rowActions={
                canEdit
                  ? (it) => (
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {/* Sesi AE-177 — PR = request-only. Terima barang lewat
                            Pembelian/GR. Sisa aksi per-item: Tolak. */}
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
                      </div>
                    )
                  : undefined
              }
            />
          </div>
        ) : (
          <div className="rounded-md border border-mahakan-green-200 bg-mahakan-green-50/60 p-3 text-xs text-mahakan-green-900">
            <CheckCircle2 className="mr-1 inline size-3.5" />
            Semua item sudah diproses
            {orderedCount > 0
              ? ` — ${orderedCount} item menunggu penerimaan PO (cek tab PO / Terima Barang).`
              : "."}
          </div>
        )}

        {/* Section item yang sudah diproses (dibeli / dalam PO / ditolak) */}
        {processedItems.length > 0 ? (
          <div className="rounded-md border border-neutral-200">
            <button
              type="button"
              onClick={() =>
                setProcessedToggle({ id: request.id, open: !processedOpen })
              }
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
              aria-expanded={processedOpen}
            >
              <span className="flex items-center gap-1.5">
                {processedOpen ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
                Sudah diproses ({processedItems.length} item)
              </span>
              <span className="text-[11px] font-normal text-neutral-500">
                dibeli / dalam PO / ditolak
              </span>
            </button>
            {processedOpen ? (
              <div className="border-t border-neutral-200 p-2">
                <ResponsiveTable<PurchaseRequestItemWithLink>
                  rows={processedItems}
                  rowKey={(it) => it.id}
                  columns={processedColumns(bucketOf)}
                />
              </div>
            ) : null}
          </div>
        ) : null}

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
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 pt-3">
            <Button variant="ghost" size="sm" onClick={() => onCancel(request)}>
              <X className="size-4" /> Batalkan PR
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              {/* Feedback Anisa — owner boleh menutup PR walau ada item yg
                  sengaja tidak dibeli (PR/PO/GR boleh beda tanggal, penutupan
                  ini keputusan owner bukan berbasis tanggal). */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => onMarkComplete(request)}
                className="border-mahakan-green-300 text-mahakan-green-800 hover:bg-mahakan-green-50"
                title="Tutup PR ini sebagai Selesai"
              >
                <CheckCircle2 className="size-4" /> Tandai Selesai
              </Button>
              {/* Feedback Cacil 2026-06-12 — Tarik hanya kalau masih ada item
                  yang BELUM diproses (dulu: anyRemaining received<requested →
                  item under-buy/dalam PO bisa ketarik lagi = dobel data). */}
              {outstandingItems.length > 0 ? (
                <Button size="sm" onClick={() => onPullToPurchase(request)}>
                  <FileText className="size-4" />
                  Tarik ke Pembelian
                </Button>
              ) : null}
            </div>
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

function ingredientColumn(): ResponsiveColumn<PurchaseRequestItemWithLink> {
  return {
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
  };
}

/* Sesi AE-122 — dedicated UNIT/SATUAN column, prominent supaya jelas unit
 * yang di-request (mis. Pcs vs Kg). */
function unitColumn(): ResponsiveColumn<PurchaseRequestItemWithLink> {
  return {
    key: "unit",
    label: "Satuan",
    render: (it) => (
      <span className="inline-flex rounded-md bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-700">
        {it.unitSnapshot}
      </span>
    ),
  };
}

/* Feedback Cacil 2026-06-12 (audit lanjutan) — qty tampil pakai decimal
 * mirror (= truth). Bigint = max(1, floor) → request staff 0.5 Kg tampil
 * jadi 1 Kg kalau baca bigint. Mirror riwayat staff /m/po. */
function qtyDisplay(bigintVal: unknown, decimalVal: string | null): number {
  const d = decimalVal ? Number(decimalVal) : NaN;
  return Number.isFinite(d) && d > 0 ? d : Number(bigintVal);
}

function requestedColumn(): ResponsiveColumn<PurchaseRequestItemWithLink> {
  return {
    key: "requested",
    label: "Diminta",
    align: "right",
    render: (it) => (
      <span className="font-mono tabular-nums">
        {qtyDisplay(it.requestedQty, it.requestedQtyDecimal).toLocaleString(
          "id-ID",
        )}
      </span>
    ),
  };
}

/* Tabel "Belum diproses" — item yang belum dibeli/ditarik sama sekali.
 * Tanpa kolom Diterima/Sisa (selalu 0/penuh — cuma noise). */
function outstandingColumns(): ResponsiveColumn<PurchaseRequestItemWithLink>[] {
  return [ingredientColumn(), unitColumn(), requestedColumn()];
}

/* Tabel "Sudah diproses" — status per item menggantikan kolom "Sisa" yang
 * dulu bikin item under-buy terbaca seperti masih harus dibeli. */
function processedColumns(
  bucketOf: Map<string, PrItemBucket>,
): ResponsiveColumn<PurchaseRequestItemWithLink>[] {
  return [
    ingredientColumn(),
    unitColumn(),
    requestedColumn(),
    {
      key: "received",
      label: "Diterima",
      align: "right",
      render: (it) => (
        <span className="font-mono tabular-nums">
          {qtyDisplay(it.receivedQty, it.receivedQtyDecimal).toLocaleString(
            "id-ID",
          )}
        </span>
      ),
    },
    {
      key: "state",
      label: "Status",
      align: "right",
      render: (it) => {
        const bucket = bucketOf.get(it.id);
        if (bucket === "rejected") {
          return (
            <span className="inline-flex items-center gap-1 rounded-full bg-danger-100 px-2 py-0.5 text-[10px] font-semibold text-danger-500">
              <X className="size-3" /> Ditolak
            </span>
          );
        }
        if (bucket === "ordered") {
          return <Badge variant="info">Dalam PO · menunggu</Badge>;
        }
        const under =
          qtyDisplay(it.receivedQty, it.receivedQtyDecimal) <
          qtyDisplay(it.requestedQty, it.requestedQtyDecimal);
        return (
          <Badge variant="success">
            {under ? "Dibeli (qty disesuaikan)" : "Dibeli"}
          </Badge>
        );
      },
    },
  ];
}
