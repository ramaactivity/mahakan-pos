"use client";

import { useEffect, useState } from "react";
import { Ban, CheckCircle2, RotateCcw } from "lucide-react";
import {
  Badge,
  Button,
  Input,
  Modal,
  Spinner,
  toast,
} from "@/components/ui";
import { ApproverOverrideModal } from "./ApproverOverrideModal";
import { ApprovalCodeModal } from "./ApprovalCodeModal";
import { PrintStationButtons } from "./PrintStationButtons";
import {
  isOk,
  getTransaction,
  logTransactionReprint,
  voidTransaction,
  refundTransaction,
  refundTransactionPartial,
  markServed,
  type RefundTransactionPartialItem,
  type TransactionWithItems,
} from "@/features/transactions";
import { useSession } from "@/features/auth/SessionProvider";
import type {
  ReceiptConfig,
  TicketSection,
} from "@/lib/printer/print-transaction";
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
  /** Outlet-driven receipt config (header/wifi/footer) — propagated from
   * PosShell so reprints match the auto-print format on payment. */
  receiptConfig: ReceiptConfig | null;
  /** Outlet flag — picks between legacy PIN approval modal vs new
   * Owner-only email-code modal. Default "pin" preserves field-test path. */
  approvalModes: { voidMode: "pin" | "code"; refundMode: "pin" | "code" };
  onClose: () => void;
  /** Called when transaction state changes (void/refund/serve) — parent should refresh list. */
  onChanged: () => void;
  /** Called when user taps "Buka" in the not-paired toast — parent switches to settings tab. */
  onOpenSettings: () => void;
}

export function HistoryDetailModal({
  open,
  trxId,
  viewerRole,
  receiptConfig,
  approvalModes,
  onClose,
  onChanged,
  onOpenSettings,
}: HistoryDetailModalProps) {
  const { session } = useSession();
  const [trx, setTrx] = useState<TransactionWithItems | null>(null);
  const [loading, setLoading] = useState(true);

  function handleReprintLogged(_key: string, sections: TicketSection[]) {
    if (!trx) return;
    // Fire-and-forget — audit log shouldn't block kasir from continuing.
    void logTransactionReprint(trx.id, sections).catch((e) => {
      console.error("[reprint audit]", e);
    });
  }

  const [actionModal, setActionModal] = useState<ActionType | null>(null);
  const [reason, setReason] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** When refund mode is partial, this holds per-item refund quantities.
   * Keyed by transaction_item.id. Empty map = full refund. */
  const [partialMode, setPartialMode] = useState(false);
  const [partialQty, setPartialQty] = useState<Record<string, number>>({});

  const [approverOpen, setApproverOpen] = useState(false);
  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<{
    actionType: ActionType;
    finalReason: string;
    /** When set, this is a partial refund — pass these items to server. */
    partialItems?: RefundTransactionPartialItem[];
  } | null>(null);

  useEffect(() => {
    if (!open || !trxId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTrx(null);
      setActionModal(null);
      setReason("");
      setCustomReason("");
      setError(null);
      setPartialMode(false);
      setPartialQty({});
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
    (trx?.status === "paid" || trx?.status === "partially_refunded") &&
    trx.paymentMethod === "cash" &&
    isSameDay;

  const reasonList = actionModal === "void" ? VOID_REASONS : REFUND_REASONS;
  const finalReason = reason === "Lainnya" ? customReason.trim() : reason;

  async function performAction(
    actionType: ActionType,
    reasonText: string,
    approver?:
      | { kind: "pin"; approverId: string; token: string }
      | { kind: "code"; code: string },
    partialItems?: RefundTransactionPartialItem[],
  ) {
    if (!trx) return;
    setSubmitting(true);
    setError(null);

    const authPayload = approver
      ? approver.kind === "pin"
        ? { approverToken: approver.token }
        : { approvalCode: approver.code }
      : {};

    if (actionType === "void") {
      const res = await voidTransaction({
        transactionId: trx.id,
        reason: reasonText,
        ...authPayload,
      });
      if (!isOk(res)) {
        setError(res.error.message);
        setSubmitting(false);
        return;
      }
      setTrx({ ...trx, ...res.data });
      toast.success("Transaksi di-void");
    } else if (partialItems && partialItems.length > 0) {
      const res = await refundTransactionPartial({
        transactionId: trx.id,
        items: partialItems,
        reason: reasonText,
        ...authPayload,
      });
      if (!isOk(res)) {
        setError(res.error.message);
        setSubmitting(false);
        return;
      }
      setTrx({ ...trx, ...res.data.transaction });
      const refundedAmount =
        res.data.transaction.refundedAmount - (trx.refundedAmount ?? 0);
      toast.success(
        `Refund parsial ${formatRupiah(refundedAmount)} — sisa transaksi ${formatRupiah(res.data.transaction.total - res.data.transaction.refundedAmount)}`,
      );
    } else {
      const res = await refundTransaction({
        transactionId: trx.id,
        reason: reasonText,
        ...authPayload,
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
    setPartialMode(false);
    setPartialQty({});
    setSubmitting(false);
    onChanged();
  }

  function onSubmitAction() {
    if (!actionModal) return;
    if (finalReason.length === 0) {
      setError("Alasan wajib diisi");
      return;
    }

    // Build partial items list if in partial refund mode
    let partialItems: RefundTransactionPartialItem[] | undefined;
    if (actionModal === "refund" && partialMode && trx) {
      partialItems = trx.items
        .map((it) => {
          const qty = partialQty[it.id] ?? 0;
          return qty > 0
            ? { transactionItemId: it.id, quantity: qty }
            : null;
        })
        .filter(
          (x): x is RefundTransactionPartialItem => x !== null,
        );
      if (partialItems.length === 0) {
        setError("Pilih minimal 1 item dengan qty > 0");
        return;
      }
    }

    const mode =
      actionModal === "void"
        ? approvalModes.voidMode
        : approvalModes.refundMode;
    setPendingApproval({
      actionType: actionModal,
      finalReason,
      partialItems,
    });
    setActionModal(null);
    if (mode === "code") {
      setCodeModalOpen(true);
    } else {
      setApproverOpen(true);
    }
  }

  function onApproverVerified(result: { approverId: string; token: string }) {
    if (!pendingApproval) return;
    void performAction(
      pendingApproval.actionType,
      pendingApproval.finalReason,
      { kind: "pin", approverId: result.approverId, token: result.token },
      pendingApproval.partialItems,
    );
    setApproverOpen(false);
    setPendingApproval(null);
  }

  function onCodeApproved(code: string) {
    if (!pendingApproval) return;
    void performAction(
      pendingApproval.actionType,
      pendingApproval.finalReason,
      { kind: "code", code },
      pendingApproval.partialItems,
    );
    setCodeModalOpen(false);
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
              }${trx.customerName ? ` · ${trx.customerName}` : ""} · ${formatIndonesianDateTime(trx.createdAt)}`
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

            <div className="space-y-2 border-t border-neutral-200 pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                Cetak Ulang
              </p>
              <PrintStationButtons
                trx={trx}
                cashierName={session?.user.name ?? "Kasir"}
                receiptConfig={receiptConfig}
                onOpenSettings={() => {
                  onClose();
                  onOpenSettings();
                }}
                onAfterPrint={handleReprintLogged}
                size="sm"
                layout="row"
              />
            </div>

            <div className="flex flex-wrap gap-2 border-t border-neutral-200 pt-3">
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
          {actionModal === "refund" && trx ? (
            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-700">
                  Mode Refund
                </span>
                <div className="flex gap-1 rounded-md bg-white p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setPartialMode(false);
                      setPartialQty({});
                    }}
                    className={`rounded px-3 py-1 transition-colors ${
                      !partialMode
                        ? "bg-mahakan-green-700 text-white"
                        : "text-neutral-600 hover:bg-neutral-100"
                    }`}
                  >
                    Penuh
                  </button>
                  <button
                    type="button"
                    onClick={() => setPartialMode(true)}
                    className={`rounded px-3 py-1 transition-colors ${
                      partialMode
                        ? "bg-mahakan-green-700 text-white"
                        : "text-neutral-600 hover:bg-neutral-100"
                    }`}
                  >
                    Per Item
                  </button>
                </div>
              </div>
              {partialMode ? (
                <div className="space-y-2">
                  {trx.items.map((it) => {
                    const remaining = it.quantity - it.refundedQuantity;
                    const selected = partialQty[it.id] ?? 0;
                    const disabled = remaining <= 0;
                    const perUnitNet = it.quantity > 0 ? Math.floor((it.subtotal - (it.refundedAmount ?? 0)) / Math.max(remaining, 1)) : 0;
                    return (
                      <div
                        key={it.id}
                        className={`flex items-center justify-between gap-2 rounded-md border bg-white p-2 ${
                          disabled ? "opacity-50" : ""
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-neutral-900">
                            {it.itemName}
                            {it.variant ? (
                              <span className="ml-1 text-xs text-neutral-500">
                                ({it.variant === "hot" ? "Hot" : "Iced"})
                              </span>
                            ) : null}
                          </p>
                          <p className="text-xs text-neutral-500">
                            Qty {it.quantity}
                            {it.refundedQuantity > 0
                              ? ` · ${it.refundedQuantity} sudah di-refund`
                              : ""}
                            {" · "}
                            {formatRupiah(perUnitNet)}/unit
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            disabled={disabled || selected === 0}
                            onClick={() =>
                              setPartialQty((q) => ({
                                ...q,
                                [it.id]: Math.max((q[it.id] ?? 0) - 1, 0),
                              }))
                            }
                            className="size-7 rounded-md border border-neutral-300 text-sm font-bold disabled:opacity-30"
                          >
                            −
                          </button>
                          <span className="w-6 text-center font-mono text-sm">
                            {selected}
                          </span>
                          <button
                            type="button"
                            disabled={disabled || selected >= remaining}
                            onClick={() =>
                              setPartialQty((q) => ({
                                ...q,
                                [it.id]: Math.min(
                                  (q[it.id] ?? 0) + 1,
                                  remaining,
                                ),
                              }))
                            }
                            className="size-7 rounded-md border border-neutral-300 text-sm font-bold disabled:opacity-30"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <p className="text-xs text-neutral-500">
                    Refund per item — pilih qty per item. Server hitung pro-rata
                    rupiah berdasarkan share + diskon. Stock tidak otomatis
                    di-restore (full refund saja).
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

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

      {trx ? (
        <ApprovalCodeModal
          open={codeModalOpen && pendingApproval !== null}
          actionType={
            pendingApproval?.actionType === "void"
              ? "pos.transaction.void"
              : "pos.transaction.refund"
          }
          transactionId={trx.id}
          transactionNumber={trx.transactionNumber}
          transactionTotal={trx.total}
          reason={pendingApproval?.finalReason ?? ""}
          onClose={() => {
            setCodeModalOpen(false);
            setPendingApproval(null);
          }}
          onApproved={onCodeApproved}
        />
      ) : null}
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
