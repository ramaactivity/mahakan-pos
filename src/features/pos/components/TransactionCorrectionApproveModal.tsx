"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button, Input, Modal, toast } from "@/components/ui";
import { approveTransactionCorrection } from "@/features/transactions/correction-actions";
import { isOk, type PaymentMethod } from "@/features/transactions";
import { formatRupiah } from "@/lib/format";
import { paymentMethodLabel } from "@/lib/payment-method";

interface TransactionCorrectionApproveModalProps {
  open: boolean;
  correctionId: string;
  transactionNumber: string;
  /** Pending correction summary untuk konfirmasi owner sebelum input kode. */
  summary: {
    originalPaymentMethod: string;
    originalTotal: number;
    correctedPaymentMethod: string;
    correctedTotal: number;
    reason: string;
    codeFirstTwo: string | null;
    requestedByName: string | null;
  };
  onClose: () => void;
  onApproved: () => void;
}

/**
 * Sesi AE-62r — owner input 6-digit kode untuk approve koreksi transaksi
 * yang sudah pending. Mirror flow ApprovalCodeModal step 'input' tapi tanpa
 * request step (kode sudah ke-generate saat kasir submit di TransactionCorrectionModal).
 */
export function TransactionCorrectionApproveModal({
  open,
  correctionId,
  transactionNumber,
  summary,
  onClose,
  onApproved,
}: TransactionCorrectionApproveModalProps) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setCode("");
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  async function onSubmit() {
    if (!/^\d{6}$/.test(code)) {
      setError("Kode harus 6 digit angka");
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await approveTransactionCorrection({ correctionId, code });
    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    toast.success(
      `Koreksi TRX ${transactionNumber} di-apply — journal di-adjust otomatis.`,
    );
    onApproved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Approve Koreksi Transaksi"
      description={`TRX ${transactionNumber} — input kode 6-digit yang Owner punya.`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button
            onClick={onSubmit}
            disabled={submitting || code.length !== 6}
            loading={submitting}
          >
            <ShieldCheck className="size-4" aria-hidden /> Approve
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-600">Requester</dt>
              <dd className="font-medium">
                {summary.requestedByName ?? "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-600">Metode bayar</dt>
              <dd className="font-medium">
                {paymentMethodLabel(
                  summary.originalPaymentMethod as PaymentMethod,
                )}{" "}
                →{" "}
                <span className="text-mahakan-green-900">
                  {paymentMethodLabel(
                    summary.correctedPaymentMethod as PaymentMethod,
                  )}
                </span>
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-600">Total</dt>
              <dd className="font-mono">
                {formatRupiah(summary.originalTotal)} →{" "}
                <span className="font-bold text-mahakan-green-900">
                  {formatRupiah(summary.correctedTotal)}
                </span>
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-600">Alasan</dt>
              <dd className="text-right">{summary.reason}</dd>
            </div>
          </dl>
        </div>

        <Input
          label="Kode 6 Digit"
          value={code}
          onChange={(e) =>
            setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
          }
          placeholder="123456"
          inputMode="numeric"
          maxLength={6}
          autoFocus
          className="text-center font-mono text-xl tracking-[0.5em]"
          hint={
            summary.codeFirstTwo
              ? `Kode dikirim ke Owner via email — dimulai ${summary.codeFirstTwo}…`
              : "Kode dikirim ke Owner via email — minta forward via WA."
          }
        />

        {error ? (
          <p
            role="alert"
            className="rounded-md bg-danger-100/60 px-3 py-2 text-sm font-medium text-danger-500"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
