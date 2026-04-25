"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Printer,
  RotateCcw,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Modal,
  Spinner,
  toast,
} from "@/components/ui";
import { ApproverOverrideModal } from "@/features/pos/components/ApproverOverrideModal";
import { useSession } from "@/features/auth/SessionProvider";
import { isOk, transactionService } from "@/mocks/services";
import type { Transaction } from "@/mocks/types";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianDateTime } from "@/lib/date";

type ActionType = "void" | "refund";

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

export default function HistoryDetailPage() {
  const params = useParams<{ id: string }>();
  const trxId = params.id;
  const { session } = useSession();

  const [trx, setTrx] = useState<Transaction | null>(null);
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
    let cancelled = false;
    async function load() {
      setLoading(true);
      const res = await transactionService.getTransaction(trxId);
      if (cancelled) return;
      if (isOk(res)) setTrx(res.data);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [trxId]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="size-8 text-mahakan-green-700" />
      </div>
    );
  }

  if (!trx || !session) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <p className="text-neutral-700">Transaksi tidak ditemukan.</p>
        <Link
          href="/pos/history"
          className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-mahakan-green-700 hover:underline"
        >
          Kembali ke riwayat
        </Link>
      </div>
    );
  }

  const reasonList = actionModal === "void" ? VOID_REASONS : REFUND_REASONS;
  const finalReason =
    reason === "Lainnya" ? customReason.trim() : reason;
  const today = new Date().toISOString().slice(0, 10);
  const isSameDay = trx.createdAt.slice(0, 10) === today;
  const canRefund =
    trx.status === "paid" && trx.paymentMethod === "cash" && isSameDay;
  const canVoid = trx.status === "paid";
  const isStaff = session.user.role === "staff";

  async function performAction(
    actionType: ActionType,
    reasonText: string,
    approver?: { approverId: string; token: string },
  ) {
    if (!session) return;
    setSubmitting(true);
    setError(null);

    if (actionType === "void") {
      const res = await transactionService.voidTransaction({
        transactionId: trxId,
        reason: reasonText,
        voidedBy: session.user.id,
        approverId: approver?.approverId,
        approverToken: approver?.token,
      });
      if (!isOk(res)) {
        setError(res.error.message);
        setSubmitting(false);
        return;
      }
      setTrx(res.data);
      toast.success("Transaksi di-void");
    } else {
      const res = await transactionService.refundTransaction({
        transactionId: trxId,
        reason: reasonText,
        refundedBy: session.user.id,
        approverId: approver?.approverId,
        approverToken: approver?.token,
      });
      if (!isOk(res)) {
        setError(res.error.message);
        setSubmitting(false);
        return;
      }
      setTrx(res.data.transaction);
      toast.success(
        `Refund ${formatRupiah(res.data.transaction.total)} — entry expense ter-create`,
      );
    }

    setActionModal(null);
    setReason("");
    setCustomReason("");
    setSubmitting(false);
  }

  function onSubmitAction() {
    if (!actionModal) return;
    if (finalReason.length === 0) {
      setError("Alasan wajib diisi");
      return;
    }
    if (isStaff) {
      // Staff → ApproverOverrideModal
      setPendingApproval({ actionType: actionModal, finalReason });
      setActionModal(null);
      setApproverOpen(true);
      return;
    }
    void performAction(actionModal, finalReason);
  }

  function onApproverVerified(result: {
    approverId: string;
    token: string;
  }) {
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
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        href="/pos/history"
        className="inline-flex items-center gap-1 text-sm font-medium text-neutral-700 hover:text-neutral-900"
      >
        <ArrowLeft className="size-4" aria-hidden /> Riwayat
      </Link>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="font-mono">
                {trx.transactionNumber}
              </CardTitle>
              <CardDescription>
                Pager <span className="font-mono">{trx.pagerNumber}</span> ·{" "}
                {trx.orderType === "dine_in" ? "Dine-in" : "Takeaway"} ·{" "}
                {formatIndonesianDateTime(trx.createdAt)}
              </CardDescription>
            </div>
            <StatusBadge status={trx.status} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {trx.items.map((item) => (
              <div
                key={item.id}
                className="flex items-start justify-between gap-3 border-b border-neutral-200 pb-2 last:border-0"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-neutral-900">
                    {item.quantity}× {item.itemName}
                    {item.variant ? (
                      <span className="text-neutral-500">
                        {" "}
                        ({item.variant === "hot" ? "Hot" : "Iced"})
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
                <span className="font-mono text-sm">
                  {formatRupiah(item.subtotal)}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-1 border-t border-neutral-200 pt-3 text-sm">
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
            <div className="border-t border-neutral-200 pt-2">
              <Row label="TOTAL" value={formatRupiah(trx.total)} bold />
            </div>
            <Row
              label="Bayar"
              value={
                trx.paymentMethod === "cash"
                  ? `Tunai ${formatRupiah(trx.cashReceived ?? 0)} (kembali ${formatRupiah(trx.cashChange ?? 0)})`
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
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => toast.info("Cetak ulang tersedia di M16")}
        >
          <Printer className="size-4" aria-hidden /> Cetak Ulang
        </Button>
        {trx.servedAt === null && trx.status === "paid" ? (
          <Button
            onClick={async () => {
              const res = await transactionService.markServed(trxId);
              if (isOk(res)) {
                setTrx(res.data);
                toast.success("Ditandai selesai");
              }
            }}
          >
            <CheckCircle2 className="size-4" aria-hidden /> Tandai Selesai
          </Button>
        ) : null}
        {canVoid ? (
          <Button
            variant="destructive"
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
      </div>

      {/* Action modal (void/refund) */}
      <Modal
        open={actionModal !== null}
        onClose={() => setActionModal(null)}
        title={actionModal === "void" ? "Void Transaksi" : "Refund Transaksi"}
        description={
          actionModal === "void"
            ? "Pilih alasan void. Transaksi tidak masuk laporan penjualan."
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
        targetEntityId={trxId}
        title={`${pendingApproval?.actionType === "void" ? "Void" : "Refund"} Butuh Approval`}
        description="Owner / Manager input PIN untuk authorize."
        onClose={() => {
          setApproverOpen(false);
          setPendingApproval(null);
        }}
        onVerified={onApproverVerified}
      />
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: Transaction["status"];
}) {
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
