"use client";

import { useEffect, useState } from "react";
import { Ban } from "lucide-react";
import { Button, Input, Modal, toast } from "@/components/ui";
import { rejectTransactionCorrection } from "@/features/transactions/correction-actions";
import { isOk } from "@/features/transactions";

interface TransactionCorrectionRejectModalProps {
  open: boolean;
  correctionId: string;
  transactionNumber: string;
  onClose: () => void;
  onRejected: () => void;
}

const REJECT_PRESETS = [
  "Tidak perlu — kasir bisa redo bayar",
  "Permintaan tidak masuk akal",
  "Bukti tidak cukup",
  "Lainnya",
];

/**
 * Sesi AE-62r — owner/manager reject koreksi yang pending. Wajib input alasan
 * (min 3 char). Setelah reject, kode di-revoke + status='rejected', kasir
 * harus re-submit kalau tetap mau koreksi.
 */
export function TransactionCorrectionRejectModal({
  open,
  correctionId,
  transactionNumber,
  onClose,
  onRejected,
}: TransactionCorrectionRejectModalProps) {
  const [reason, setReason] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setReason("");
    setCustomReason("");
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  const finalReason = reason === "Lainnya" ? customReason.trim() : reason;

  async function onSubmit() {
    if (finalReason.length < 3) {
      setError("Alasan minimal 3 karakter.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await rejectTransactionCorrection({
      correctionId,
      reason: finalReason,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    toast.info(`Koreksi TRX ${transactionNumber} di-reject.`);
    onRejected();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tolak Koreksi"
      description={`TRX ${transactionNumber} — kasir harus re-submit kalau tetap perlu koreksi.`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button
            variant="destructive"
            onClick={onSubmit}
            disabled={submitting || finalReason.length < 3}
            loading={submitting}
          >
            <Ban className="size-4" aria-hidden /> Tolak
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {REJECT_PRESETS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={`rounded-md border py-2 text-sm transition-all ${
                reason === r
                  ? "border-danger-500 bg-danger-100/40 text-danger-700"
                  : "border-neutral-300 bg-white hover:bg-neutral-100"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        {reason === "Lainnya" ? (
          <Input
            type="text"
            value={customReason}
            onChange={(e) => setCustomReason(e.target.value)}
            placeholder="Tulis alasan reject"
            maxLength={500}
          />
        ) : null}
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
