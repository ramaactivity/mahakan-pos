"use client";

import { useEffect, useState } from "react";
import { Gift, ShieldAlert } from "lucide-react";
import { Button, Input, Modal, Select } from "@/components/ui";
import { formatRupiah } from "@/lib/format";

interface ComplimentModalProps {
  open: boolean;
  subtotal: number;
  onClose: () => void;
  /** Caller is responsible for triggering the approver PIN flow + applying
   * the compliment as a 100%-fixed discount with reason prefixed
   * "Compliment: <reason>". This modal only collects intent. */
  onSubmit: (reason: string) => void;
}

const PRESET_REASONS = [
  "VIP customer",
  "Karyawan / Staff",
  "Service recovery",
  "Test menu / R&D",
  "Tamu owner",
  "Lainnya",
] as const;

/**
 * Compliment = 100% gratis seluruh transaksi, sebagai gesture goodwill.
 * Selalu butuh approver PIN (dari role manapun — owner self-approve OK).
 * Audit log catat dengan eventType "transaction.compliment.applied" supaya
 * mudah di-filter saat audit / pelaporan compliance.
 */
export function ComplimentModal({
  open,
  subtotal,
  onClose,
  onSubmit,
}: ComplimentModalProps) {
  const [reasonPreset, setReasonPreset] = useState<string>("VIP customer");
  const [customReason, setCustomReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setReasonPreset("VIP customer");
    setCustomReason("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  function handleSubmit() {
    setError(null);
    const finalReason =
      reasonPreset === "Lainnya" ? customReason.trim() : reasonPreset;
    if (finalReason.length < 3) {
      setError("Alasan minimal 3 karakter");
      return;
    }
    onSubmit(`Compliment: ${finalReason}`);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Beri Compliment"
      description={`Subtotal ${formatRupiah(subtotal)} → 100% gratis (Rp 0)`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={handleSubmit}>
            <Gift className="size-4" aria-hidden /> Lanjut & Approve
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-warning-500/40 bg-warning-100/50 p-3 text-xs text-warning-500"
        >
          <ShieldAlert className="size-4 shrink-0" aria-hidden />
          <div className="space-y-1">
            <p className="font-semibold uppercase tracking-wide">
              Compliment butuh PIN approver
            </p>
            <p className="text-warning-500/90">
              Setelah lo tap &ldquo;Lanjut&rdquo; akan muncul prompt PIN. Owner
              bisa self-approve dengan PIN sendiri. Semua aksi compliment
              tercatat di Audit Log dengan event{" "}
              <span className="font-mono">transaction.compliment.applied</span>{" "}
              dan tidak bisa dihapus.
            </p>
          </div>
        </div>

        <Select
          label="Alasan Compliment"
          options={PRESET_REASONS.map((r) => ({ value: r, label: r }))}
          value={reasonPreset}
          onValueChange={setReasonPreset}
        />

        {reasonPreset === "Lainnya" ? (
          <Input
            label="Tulis alasan custom"
            value={customReason}
            onChange={(e) => setCustomReason(e.target.value)}
            placeholder="Tulis alasan compliment…"
            maxLength={120}
          />
        ) : null}

        {error ? (
          <p className="rounded-md bg-danger-100 p-2 text-sm text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
