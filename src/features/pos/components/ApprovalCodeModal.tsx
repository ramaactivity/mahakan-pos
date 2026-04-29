"use client";

import { useEffect, useState } from "react";
import { Mail, Send, ShieldCheck } from "lucide-react";
import { Button, Input, Modal, toast } from "@/components/ui";
import {
  isOk,
  requestApprovalCode,
  type ApprovalActionType,
} from "@/features/approval-codes";
import { formatRupiah } from "@/lib/format";

interface ApprovalCodeModalProps {
  open: boolean;
  actionType: ApprovalActionType;
  transactionId: string;
  transactionNumber: string;
  transactionTotal: number;
  reason: string;
  onClose: () => void;
  onApproved: (code: string) => void;
}

type Step = "request" | "input";

export function ApprovalCodeModal({
  open,
  actionType,
  transactionId,
  transactionNumber,
  transactionTotal,
  reason,
  onClose,
  onApproved,
}: ApprovalCodeModalProps) {
  const [step, setStep] = useState<Step>("request");
  const [requesting, setRequesting] = useState(false);
  const [emailMasked, setEmailMasked] = useState<string>("");
  const [codeFirstTwo, setCodeFirstTwo] = useState<string>("");
  const [emailMode, setEmailMode] = useState<"sent" | "logged" | "failed">("sent");
  const [code, setCode] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setStep("request");
    setCode("");
    setError(null);
    setSubmitting(false);
    setRequesting(false);
    setEmailMasked("");
    setCodeFirstTwo("");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  async function handleRequest() {
    if (requesting) return;
    setRequesting(true);
    setError(null);
    const res = await requestApprovalCode({
      transactionId,
      actionType,
      reason,
    });
    setRequesting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    setEmailMasked(res.data.ownerEmailMasked);
    setCodeFirstTwo(res.data.codeFirstTwo);
    setEmailMode(res.data.emailMode);
    setStep("input");
    if (res.data.emailMode === "sent") {
      toast.success(`Kode dikirim ke email Owner (${res.data.ownerEmailMasked})`);
    } else if (res.data.emailMode === "logged") {
      toast.info("Dev mode — kode di-log ke server console");
    } else {
      toast.warning(
        "Email gagal kirim — minta Owner cek admin Approval Codes panel atau coba lagi",
      );
    }
  }

  async function handleSubmit() {
    if (submitting) return;
    if (!/^\d{6}$/.test(code)) {
      setError("Kode harus 6 digit angka");
      return;
    }
    setSubmitting(true);
    setError(null);
    // Caller does the actual void/refund call. We just hand back the code.
    onApproved(code);
    setSubmitting(false);
  }

  const actionLabel =
    actionType === "pos.transaction.void" ? "Void" : "Refund";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${actionLabel} Butuh Kode Owner`}
      description={`TRX ${transactionNumber} — ${formatRupiah(transactionTotal)}`}
      size="md"
      footer={
        step === "request" ? (
          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={onClose}>
              Batal
            </Button>
            <Button onClick={handleRequest} disabled={requesting}>
              <Send className="size-4" />
              {requesting ? "Mengirim..." : "Minta Kode dari Owner"}
            </Button>
          </div>
        ) : (
          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={onClose}>
              Batal
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || code.length !== 6}
            >
              <ShieldCheck className="size-4" />
              {submitting ? "Memproses..." : "Approve"}
            </Button>
          </div>
        )
      }
    >
      {step === "request" ? (
        <div className="space-y-4 text-sm">
          <div className="rounded-md border border-amber-200 bg-amber-50/40 p-3">
            <p className="font-medium text-amber-800">
              Email + kode 6-digit akan dikirim ke Owner.
            </p>
            <p className="mt-1 text-xs text-neutral-700">
              Owner forward kode ke kamu via WhatsApp untuk approve. Kode
              berlaku 10 menit, single-use, dan terikat ke transaksi ini.
            </p>
          </div>
          <dl className="space-y-1 text-xs">
            <div className="flex justify-between">
              <dt className="text-neutral-500">Aksi</dt>
              <dd className="font-medium">{actionLabel}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-neutral-500">Transaksi</dt>
              <dd className="font-mono">{transactionNumber}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-neutral-500">Total</dt>
              <dd className="font-mono">{formatRupiah(transactionTotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-neutral-500">Alasan</dt>
              <dd className="text-right">{reason}</dd>
            </div>
          </dl>
          {error ? (
            <p className="rounded-md bg-danger-100/50 p-2 text-sm text-danger-500" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-md border border-mahakan-green-200 bg-mahakan-green-50/40 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-mahakan-green-900">
              <Mail className="size-4" aria-hidden /> Kode dikirim ({emailMode})
            </p>
            <p className="mt-1 text-xs text-neutral-700">
              Email tujuan: <span className="font-mono">{emailMasked}</span>
              <br />
              Kode dimulai: <span className="font-mono font-semibold">{codeFirstTwo}…</span>
              {emailMode === "logged" ? (
                <>
                  <br />
                  <span className="text-warning-500">
                    Dev mode — cek server console untuk kode lengkap.
                  </span>
                </>
              ) : null}
            </p>
          </div>
          <Input
            label="Masukkan kode 6 digit dari Owner"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
            maxLength={6}
            inputMode="numeric"
            autoFocus
            className="text-center font-mono text-xl tracking-[0.5em]"
            hint="Kode dikirim ke Owner via email; Owner forward via WA."
          />
          {error ? (
            <p className="rounded-md bg-danger-100/50 p-2 text-sm text-danger-500" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            onClick={handleRequest}
            disabled={requesting}
            className="text-xs text-mahakan-green-700 hover:underline disabled:opacity-50"
          >
            {requesting ? "Mengirim ulang..." : "Minta kode baru (kalau Owner tidak menerima email)"}
          </button>
        </div>
      )}
    </Modal>
  );
}
