"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Receipt,
  User,
} from "lucide-react";
import {
  Badge,
  Modal,
  Skeleton,
} from "@/components/ui";
import {
  getRvcEventDetail,
  isOk,
  type RefundVoidComplimentDetail,
  type RefundVoidComplimentEvent,
  type RefundVoidComplimentKind,
} from "@/features/reports";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<RefundVoidComplimentKind, string> = {
  refund_full: "Refund Full",
  refund_partial: "Refund Partial",
  void: "Void",
  compliment: "Komplimen",
};

const KIND_VARIANT: Record<
  RefundVoidComplimentKind,
  "warning" | "neutral" | "info" | "danger"
> = {
  refund_full: "danger",
  refund_partial: "warning",
  void: "neutral",
  compliment: "info",
};

interface Props {
  event: RefundVoidComplimentEvent;
  onClose: () => void;
}

export function RefundVoidComplimentDetailModal({ event, onClose }: Props) {
  const [detail, setDetail] = useState<RefundVoidComplimentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setDetail(null);
    setError(null);
    void (async () => {
      const res = await getRvcEventDetail(event.eventId, event.kind);
      if (cancelled) return;
      if (isOk(res)) setDetail(res.data);
      else setError(res.error.message);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [event.eventId, event.kind]);

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Detail ${KIND_LABEL[event.kind]}`}
      description={`No. ${event.transactionNumber} · ${new Date(event.occurredAt).toLocaleString("id-ID")}`}
      size="xl"
    >
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : error ? (
        <p className="text-sm text-danger-500">{error}</p>
      ) : !detail ? (
        <p className="py-6 text-center text-sm text-neutral-500">
          Event tidak ditemukan.
        </p>
      ) : (
        <DetailContent detail={detail} />
      )}
    </Modal>
  );
}

function DetailContent({ detail }: { detail: RefundVoidComplimentDetail }) {
  const { event, items, originalTransaction, auditTrail, inventoryImpact } =
    detail;

  return (
    <div className="space-y-4">
      {/* Kind badge + summary */}
      <div className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
        <div>
          <Badge variant={KIND_VARIANT[event.kind]}>
            {KIND_LABEL[event.kind]}
          </Badge>
          <p className="mt-1 text-sm text-neutral-700">
            <span className="font-mono">{event.transactionNumber}</span>
            {event.customerName ? ` · ${event.customerName}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-xl font-bold text-neutral-900">
            {formatRupiah(event.amountImpact)}
          </p>
          <p className="text-[11px] text-neutral-500">
            {event.itemCount} item · COGS {formatRupiah(event.cogsImpact)}
          </p>
        </div>
      </div>

      {/* Inventory impact banner */}
      {inventoryImpact.warning ? (
        <div className="flex items-start gap-2 rounded-md border border-warning-100 bg-warning-50 p-2.5 text-xs text-warning-500">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>{inventoryImpact.warning}</p>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-md border border-mahakan-green-100 bg-mahakan-green-50/50 p-2.5 text-xs text-mahakan-green-900">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <p>
            Stok sudah otomatis di-restore via inventory_movement (kind:{" "}
            <span className="font-mono">
              {event.kind === "void" ? "void_restore" : "refund_restore"}
            </span>
            ).
          </p>
        </div>
      )}

      {/* Original transaction summary */}
      <section>
        <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          <Receipt className="size-3.5" />
          Transaksi Asli
        </h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-neutral-200 bg-white p-3 text-xs">
          <span className="text-neutral-500">No. Transaksi:</span>
          <span className="font-mono text-neutral-900">
            {originalTransaction.transactionNumber}
          </span>
          <span className="text-neutral-500">Total:</span>
          <span className="font-mono text-neutral-900">
            {formatRupiah(originalTransaction.total)}
          </span>
          <span className="text-neutral-500">Refunded Amount:</span>
          <span className="font-mono text-neutral-900">
            {formatRupiah(originalTransaction.refundedAmount)}
          </span>
          <span className="text-neutral-500">Status:</span>
          <span className="text-neutral-900">{originalTransaction.status}</span>
          <span className="text-neutral-500">Payment:</span>
          <span className="text-neutral-900">
            {originalTransaction.paymentMethod}
          </span>
          <span className="text-neutral-500">Tanggal:</span>
          <span className="text-neutral-900">
            {new Date(originalTransaction.closedAt).toLocaleString("id-ID")}
          </span>
        </div>
      </section>

      {/* Items affected */}
      <section>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Items Affected ({items.length})
        </h3>
        {items.length === 0 ? (
          <p className="py-3 text-center text-xs text-neutral-500">
            Tidak ada item detail (event tanpa line items).
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-neutral-200">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50 text-neutral-600">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">Item</th>
                  <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                  <th className="px-2 py-1.5 text-right font-medium">
                    Unit Price
                  </th>
                  <th className="px-2 py-1.5 text-right font-medium">
                    Impact
                  </th>
                  <th className="px-2 py-1.5 text-right font-medium">COGS</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx} className="border-t border-neutral-100">
                    <td className="px-2 py-1.5 text-neutral-900">
                      {it.itemName}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">
                      {it.qty.toLocaleString("id-ID")}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">
                      {formatRupiah(it.unitPrice)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono font-semibold">
                      {formatRupiah(it.amountImpact)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-neutral-600">
                      {formatRupiah(it.cogsAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Approval chain */}
      <section>
        <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          <User className="size-3.5" />
          Approval Chain
        </h3>
        <div className="space-y-1 rounded-md border border-neutral-200 bg-white p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-neutral-500">Kasir / Initiator:</span>
            <span className="font-medium text-neutral-900">
              {event.cashierName ?? "—"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-neutral-500">Approver:</span>
            <span className="font-medium text-neutral-900">
              {event.approverName ?? "—"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-neutral-500">Waktu:</span>
            <span className="font-mono text-neutral-900">
              {new Date(event.occurredAt).toLocaleString("id-ID")}
            </span>
          </div>
        </div>
      </section>

      {/* Reason */}
      {event.reason ? (
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Alasan
          </h3>
          <p className="rounded-md border border-neutral-200 bg-white p-3 font-mono text-xs text-neutral-700">
            {event.reason}
          </p>
        </section>
      ) : null}

      {/* Audit trail */}
      {auditTrail.length > 0 ? (
        <section>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            <Activity className="size-3.5" />
            Audit Trail
          </h3>
          <div className="overflow-x-auto rounded-md border border-neutral-200">
            <table className="w-full text-[11px]">
              <thead className="bg-neutral-50 text-neutral-600">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">Waktu</th>
                  <th className="px-2 py-1.5 text-left font-medium">Event</th>
                  <th className="px-2 py-1.5 text-left font-medium">Aktor</th>
                  <th className="px-2 py-1.5 text-left font-medium">
                    Summary
                  </th>
                </tr>
              </thead>
              <tbody>
                {auditTrail.map((a, idx) => (
                  <tr
                    key={idx}
                    className={cn(
                      "border-t border-neutral-100",
                      a.eventType.includes("compliment")
                        ? "bg-info-100/30"
                        : a.eventType.includes("refund")
                          ? "bg-warning-50/40"
                          : a.eventType.includes("void")
                            ? "bg-neutral-100/40"
                            : "",
                    )}
                  >
                    <td className="px-2 py-1.5 text-neutral-700">
                      {new Date(a.occurredAt).toLocaleString("id-ID", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-[10px] text-neutral-600">
                      {a.eventType}
                    </td>
                    <td className="px-2 py-1.5 text-neutral-700">{a.actor}</td>
                    <td className="px-2 py-1.5 text-neutral-700">
                      {a.summary}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
