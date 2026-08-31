"use client";

import { useEffect, useState } from "react";
import { Gift, ShieldAlert } from "lucide-react";
import { Button, Input, Modal, Select } from "@/components/ui";
// Impor langsung dari file action (BUKAN barrel) — barrel ikut mengekspor
// tipe bersama action, dan webpack bisa terbawa memasukkan dependensi
// server-only (nodemailer/bcryptjs) ke bundle klien lalu PosShell gagal mount.
import { verifyComplimentPin } from "@/features/approval-codes/compliment-pin";
import { isOk } from "@/features/approval-codes/types";
import { formatRupiah } from "@/lib/format";

interface ComplimentModalProps {
  open: boolean;
  subtotal: number;
  /** Owner tidak perlu PIN — dialah yang menyetujui. */
  isOwner: boolean;
  onClose: () => void;
  /**
   * Dipanggil setelah compliment disetujui. `pin` null kalau owner sendiri
   * yang menjalankan (jalur direct-approve).
   */
  onApproved: (reason: string, pin: string | null) => void;
}

const PRESET_REASONS = [
  "VIP customer",
  "Karyawan / Staff",
  "Service recovery",
  "Test menu / R&D",
  "Tamu owner",
  "Lainnya",
] as const;

type Step = "reason" | "pin";

/**
 * Compliment = 100% gratis seluruh transaksi.
 *
 * Sesi AE-221 — approval-nya sekarang PIN STATIS, menggantikan kode 6 digit
 * yang dikirim ke owner (AE-195). Arahan owner: kasir tidak perlu lagi
 * menunggu kode.
 *
 * Yang perlu diketahui siapa pun yang membaca ini nanti: PIN yang sama
 * dipegang bersama, jadi jejaknya membuktikan "ada yang tahu PIN-nya", bukan
 * "owner menyetujui transaksi ini". Itu pertukaran yang disengaja owner demi
 * kelancaran operasional; audit log tetap mencatat kasir, alasan, dan nilai.
 *
 * Pemeriksaan di layar ini hanya supaya kasir tahu lebih awal kalau PIN-nya
 * salah. Gerbang sebenarnya ada di server (createTransaction & editOpenBill).
 */
export function ComplimentModal({
  open,
  subtotal,
  isOwner,
  onClose,
  onApproved,
}: ComplimentModalProps) {
  const [step, setStep] = useState<Step>("reason");
  const [reasonPreset, setReasonPreset] = useState<string>("VIP customer");
  const [customReason, setCustomReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setStep("reason");
    setReasonPreset("VIP customer");
    setCustomReason("");
    setError(null);
    setPin("");
    setReason("");
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  function resolveReason(): string | null {
    const finalReason =
      reasonPreset === "Lainnya" ? customReason.trim() : reasonPreset;
    if (finalReason.length < 3) {
      setError("Alasan minimal 3 karakter");
      return null;
    }
    return `Compliment: ${finalReason}`;
  }

  function handleReasonNext() {
    setError(null);
    const resolved = resolveReason();
    if (!resolved) return;

    // Owner menyetujui dirinya sendiri — tidak perlu PIN.
    if (isOwner) {
      onApproved(resolved, null);
      return;
    }
    setReason(resolved);
    setStep("pin");
  }

  async function handlePinSubmit() {
    if (submitting) return;
    setError(null);
    const candidate = pin.trim();
    if (!/^\d{4,6}$/.test(candidate)) {
      setError("PIN harus 4-6 digit angka");
      return;
    }
    setSubmitting(true);
    const res = await verifyComplimentPin(candidate);
    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      setPin("");
      return;
    }
    onApproved(reason, candidate);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Beri Compliment"
      description={`Subtotal ${formatRupiah(subtotal)} → 100% gratis (Rp 0)`}
      size="md"
      footer={
        step === "reason" ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Batal
            </Button>
            <Button onClick={handleReasonNext}>
              <Gift className="size-4" aria-hidden />
              {isOwner ? "Terapkan Compliment" : "Lanjut — Masukkan PIN"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep("reason")}>
              Kembali
            </Button>
            <Button onClick={handlePinSubmit} disabled={submitting}>
              {submitting ? "Memeriksa…" : "Terapkan Compliment"}
            </Button>
          </>
        )
      }
    >
      {step === "reason" ? (
        <div className="space-y-4">
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-warning-500/40 bg-warning-100/50 p-3 text-xs text-warning-500"
          >
            <ShieldAlert className="size-4 shrink-0" aria-hidden />
            <div className="space-y-1">
              <p className="font-semibold uppercase tracking-wide">
                {isOwner
                  ? "Owner — langsung disetujui"
                  : "Compliment butuh PIN"}
              </p>
              <p className="text-warning-500/90">
                {isOwner
                  ? "Kamu Owner, jadi compliment langsung diterapkan tanpa PIN. Tetap tercatat di Audit Log."
                  : "Masukkan PIN compliment di layar berikutnya. Alasan, nilai, dan nama kasir tercatat di Audit Log."}
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
      ) : (
        <div className="space-y-4">
          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
            <p>
              Alasan: <strong>{reason.replace(/^Compliment:\s*/, "")}</strong>
            </p>
            <p className="mt-1 text-neutral-500">
              Nilai yang digratiskan {formatRupiah(subtotal)} — tercatat atas
              nama kasir yang sedang login.
            </p>
          </div>

          <Input
            label="PIN Compliment"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            type="password"
            placeholder="••••••"
            autoFocus
            className="text-center font-mono text-2xl tracking-[0.4em]"
          />

          {error ? (
            <p className="rounded-md bg-danger-100 p-2 text-sm text-danger-500">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
