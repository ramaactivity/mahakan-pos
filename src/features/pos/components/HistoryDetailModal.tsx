"use client";

import { useEffect, useState } from "react";
import { Ban, CheckCircle2, Printer, RotateCcw } from "lucide-react";
import {
  Badge,
  Button,
  Input,
  Modal,
  Spinner,
  toast,
} from "@/components/ui";
import { ApproverOverrideModal } from "./ApproverOverrideModal";
import {
  isOk,
  getTransaction,
  voidTransaction,
  refundTransaction,
  markServed,
  type TransactionWithItems,
} from "@/features/transactions";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianDateTime, toJakartaDateOnly } from "@/lib/date";
import type { Role } from "@/lib/auth";

const VOID_REASONS = [
  "Customer batal",
  "Salah input",
  "Keluhan customer",
  "Lainnya",
];
const REFUND_REASONS = [
  "Barang kualitas kurang baik",
  "Salah orderan",
  "Customer minta refund",
  "Lainnya",
];

type ActionType = "void" | "refund";

interface HistoryDetailModalProps {
  open: boolean;
  trxId: string | null;
  /** Active session role to scope which actions need PIN approval. */
  viewerRole: Role;
  viewerUserId: string;
  onClose: () => void;
  /** Called when transaction state changes (void/refund/serve) — parent should refresh list. */
  onChanged: () => void;
}

export function HistoryDetailModal({
  open,
  trxId,
  viewerRole,
  onClose,
  onChanged,
}: HistoryDetailModalProps) {
  const [trx, setTrx] = useState<TransactionWithItems | null>(null);
  const [loading, setLoading] = useState(true);

  const [actionModal, setActionModal] = useState<ActionType | null>(null);
  const [reason, setReason] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [approverOpen, setApproverOpen] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<{
    actionType: ActionType;
    finalReason: string;
  } | null>(null);

  useEffect(() => {
    if (!open || !trxId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTrx(null);
      setActionModal(null);
      setReason("");
      setCustomReason("");
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    async function load() {
      const res = await getTransaction(trxId!);
      if (cancelled) return;
      if (isOk(res)) setTrx(res.data);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, trxId]);

  if (!open) return null;

  const isStaff = viewerRole === "staff";
  const today = toJakartaDateOnly(new Date());
  const isSameDay = trx ? toJakartaDateOnly(trx.createdAt) === today : false;
  const canVoid = trx?.status === "paid";
  const canRefund =
    trx?.status === "paid" && trx.paymentMethod === "cash" && isSameDay;

  const reasonList = actionModal === "void" ? VOID_REASONS : REFUND_REASONS;
  const finalReason = reason === "Lainnya" ? customReason.trim() : reason;

  async function performAction(
    actionType: ActionType,
    reasonText: string,
    approver?: { approverId: string; token: string },
  ) {
    if (!trx) return;
    setSubmitting(true);
    setError(null);

    if (actionType === "void") {
      const res = await voidTransaction({
        transactionId: trx.id,
        reason: reasonText,
        approverToken: approver?.token,
      });
      if (!isOk(res)) {
        setError(res.error.message);
        setSubmitting(false);
        return;
      }
      // void returns plain Transaction; merge to keep items array on display
      setTrx({ ...trx, ...res.data });
      toast.success("Transaksi di-void");
    } else {
      const res = await refundTransaction({
        transactionId: trx.id,
        reason: reasonText,
        approverToken: approver?.token,
      });
      if (!isOk(res)) {
        setError(res.error.message);
        setSubmitting(false);
        return;
      }
      setTrx({ ...trx, ...res.data.transaction });
      toast.success(
        `Refund ${formatRupiah(res.data.transaction.total)} — entry expense ter-create`,
      );
    }

    setActionModal(null);
    setReason("");
    setCustomReason("");
    setSubmitting(false);
    onChanged();
  }

  function onSubmitAction() {
    if (!actionModal) return;
    if (finalReason.length === 0) {
      setError("Alasan wajib diisi");
      return;
    }
    if (isStaff) {
      setPendingApproval({ actionType: actionModal, finalReason });
      setActionModal(null);
      setApproverOpen(true);
      return;
    }
    void performAction(actionModal, finalReason);
  }

  function onApproverVerified(result: { approverId: string; token: string }) {
    if (!pendingApproval) return;
    void performAction(
      pendingApproval.actionType,
      pendingApproval.finalReason,
      result,
    );
    setApproverOpen(false);
    setPendingApproval(null);
  }

  return (
    <>
      <Modal
        open={open && !approverOpen && actionModal === null}
        onClose={onClose}
        title={trx?.transactionNumber ?? "Memuat…"}
        description={
          trx
            ? `Pager ${trx.pagerNumber} · ${
                trx.orderType === "dine_in" ? "Dine-in" : "Takeaway"
              } · ${formatIndonesianDateTime(trx.createdAt)}`
            : undefined
        }
        size="lg"
      >
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner className="size-6 text-mahakan-green-700" />
          </div>
        ) : !trx ? (
          <p className="text-sm text-neutral-700">Transaksi tidak ditemukan</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <StatusBadge status={trx.status} />
              <span className="font-mono text-base font-bold text-neutral-900">
                {formatRupiah(trx.total)}
              </span>
            </div>

            <div className="space-y-2 max-h-[260px] overflow-y-auto rounded-md border border-neutral-200 bg-white p-3">
              {trx.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-3 border-b border-neutral-100 pb-2 last:border-0"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-neutral-900">
                      {item.quantity}× {item.itemName}
                      {item.variant ? (
                        <span className="text-neutral-500">
                          {" "}({item.variant === "hot" ? "Hot" : "Iced"})
                        </span>
                      ) : null}
                    </p>
                    {item.modifiers.length > 0 ? (
                      <p className="text-xs text-neutral-500">
                        {item.modifiers
                          .map((m) => m.selectedValue ?? m.modifierSlug)
                          .join(" · ")}
                      </p>
                    ) : null}
                    {item.openPriceNote ? (
                      <p className="text-xs italic text-neutral-700">
                        {item.openPriceNote}
                      </p>
                    ) : null}
                    {item.note ? (
                      <p className="text-xs italic text-neutral-600">
                        &ldquo;{item.note}&rdquo;
                      </p>
                    ) : null}
                  </div>
                  <span className="font-mono text-xs">
                    {formatRupiah(item.subtotal)}
                  </span>
                </div>
              ))}
            </div>

            <div className="space-y-1 text-sm">
              <Row label="Subtotal" value={formatRupiah(trx.subtotal)} muted />
              {trx.discountAmount > 0 ? (
                <Row
                  label={`Diskon ${
                    trx.discountType === "percent"
                      ? `(${trx.discountValue}%)`
                      : ""
                  }${trx.discountReason ? ` — ${trx.discountReason}` : ""}`}
                  value={`- ${formatRupiah(trx.discountAmount)}`}
                  danger
                />
              ) : null}
              <Row label="TOTAL" value={formatRupiah(trx.total)} bold />
              <Row
                label="Bayar"
                value={
                  trx.paymentMethod === "cash"
                    ? `Tunai ${formatRupiah(trx.cashReceived ?? 0)} · kembali ${formatRupiah(trx.cashChange ?? 0)}`
                    : trx.paymentMethod === "qris"
                      ? "QRIS"
                      : "Kartu BCA"
                }
                muted
              />
              {trx.voidedAt ? (
                <Row
                  label="Voided"
                  value={`${formatIndonesianDateTime(trx.voidedAt)}${trx.voidReason ? ` — ${trx.voidReason}` : ""}`}
                  muted
                />
              ) : null}
              {trx.refundedAt ? (
                <Row
                  label="Refunded"
                  value={`${formatIndonesianDateTime(trx.refundedAt)}${trx.refundReason ? ` — ${trx.refundReason}` : ""}`}
                  muted
                />
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-neutral-200 pt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  toast.info("Cetak ulang tersedia di M16 (printer)")
                }
              >
                <Printer className="size-4" aria-hidden /> Cetak Ulang
              </Button>
              {trx.servedAt === null && trx.status === "paid" ? (
                <Button
                  size="sm"
                  onClick={async () => {
                    const res = await markServed(trx.id);
                    if (isOk(res)) {
                      setTrx({ ...trx, ...res.data });
                      toast.success("Ditandai selesai");
                      onChanged();
                    }
                  }}
                >
                  <CheckCircle2 className="size-4" aria-hidden /> Tandai Selesai
                </Button>
              ) : null}
              {canVoid ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setActionModal("void");
                    setReason("");
                    setCustomReason("");
                    setError(null);
                  }}
                >
                  <Ban className="size-4" aria-hidden /> Void
                </Button>
              ) : null}
              {canRefund ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setActionModal("refund");
                    setReason("");
                    setCustomReason("");
                    setError(null);
                  }}
                >
                  <RotateCcw className="size-4" aria-hidden /> Refund
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" onClick={onClose}>
                Tutup
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={actionModal !== null}
        onClose={() => setActionModal(null)}
        title={actionModal === "void" ? "Void Transaksi" : "Refund Transaksi"}
        description={
          actionModal === "void"
            ? "Pilih alasan void. Transaksi tidak masuk laporan."
            : "Refund kas — entry pengeluaran auto-create di kategori Refund."
        }
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setActionModal(null)}>
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={onSubmitAction}
              loading={submitting}
              disabled={finalReason.length === 0}
            >
              {actionModal === "void" ? "Konfirmasi Void" : "Konfirmasi Refund"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {reasonList.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={`rounded-md border py-2 text-sm transition-all ${
                  reason === r
                    ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                    : "border-neutral-300 bg-white hover:bg-neutral-100"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          {reason === "Lainnya" ? (
            <Input
              label="Alasan Custom"
              type="text"
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              placeholder="Tulis alasannya"
              maxLength={120}
            />
          ) : null}
          {isStaff && reason ? (
            <p className="rounded-md bg-warning-100 px-3 py-2 text-xs text-warning-500">
              ⚠️ Aksi ini butuh approval Owner / Manager via PIN.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger-500">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>

      <ApproverOverrideModal
        open={approverOpen}
        actionType={
          pendingApproval?.actionType === "void"
            ? "pos.transaction.void"
            : "pos.transaction.refund"
        }
        targetEntityId={trxId ?? undefined}
        title={`${pendingApproval?.actionType === "void" ? "Void" : "Refund"} Butuh Approval`}
        description="Owner / Manager input PIN untuk authorize."
        onClose={() => {
          setApproverOpen(false);
          setPendingApproval(null);
        }}
        onVerified={onApproverVerified}
      />
    </>
  );
}

function StatusBadge({ status }: { status: TransactionWithItems["status"] }) {
  if (status === "paid") return <Badge variant="paid">Lunas</Badge>;
  if (status === "voided") return <Badge variant="voided">Void</Badge>;
  return <Badge variant="refunded">Refund</Badge>;
}

function Row({
  label,
  value,
  muted,
  bold,
  danger,
}: {
  label: string;
  value: string;
  muted?: boolean;
  bold?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={`flex items-start justify-between gap-3 ${
        muted ? "text-neutral-500" : "text-neutral-900"
      } ${danger ? "text-danger-500" : ""} ${bold ? "text-base font-bold" : "text-sm"}`}
    >
      <span className="break-words flex-1 min-w-0">{label}</span>
      <span className={`font-mono shrink-0 ${bold ? "text-lg" : ""}`}>
        {value}
      </span>
    </div>
  );
}
