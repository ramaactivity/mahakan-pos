"use client";

import { useEffect, useState } from "react";
import { Gift, Mail, ShieldAlert, Smartphone } from "lucide-react";
import { Button, Input, Modal, Select } from "@/components/ui";
// Impor langsung dari file action (BUKAN barrel) — barrel ikut mengekspor
// tipe bersama action, dan webpack bisa terbawa memasukkan dependensi
// server-only (nodemailer/bcryptjs) ke bundle klien lalu PosShell gagal mount.
import {
  consumeComplimentApprovalCode,
  requestComplimentApprovalCode,
} from "@/features/approval-codes/compliment-actions";
import { isOk } from "@/features/approval-codes/types";
import { formatRupiah } from "@/lib/format";

interface ComplimentModalProps {
  open: boolean;
  subtotal: number;
  /** Owner tidak perlu kode — dialah yang menyetujui. */
  isOwner: boolean;
  onClose: () => void;
  /**
   * Dipanggil setelah compliment DISETUJUI. `approvalCodeId` null kalau
   * owner sendiri yang menjalankan (jalur direct-approve).
   */
  onApproved: (reason: string, approvalCodeId: string | null) => void;
}

const PRESET_REASONS = [
  "VIP customer",
  "Karyawan / Staff",
  "Service recovery",
  "Test menu / R&D",
  "Tamu owner",
  "Lainnya",
] as const;

type Step = "reason" | "code";

/**
 * Compliment = 100% gratis seluruh transaksi.
 *
 * Sesi AE-195 — approval-nya sekarang KODE DARI OWNER, bukan PIN approver.
 * Alurnya: kasir isi alasan → server kirim kode 6 digit ke owner (email +
 * push ke HP owner) → owner meneruskan kodenya ke kasir → kasir ketik.
 *
 * Kodenya sengaja TIDAK PERNAH melewati perangkat kasir sampai owner
 * memberikannya; itu inti kontrolnya. Owner yang menjalankan POS sendiri
 * lewat tanpa kode.
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

  const [requesting, setRequesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [codeFirstTwo, setCodeFirstTwo] = useState("");
  const [pushSent, setPushSent] = useState(0);
  const [emailMode, setEmailMode] = useState<"sent" | "logged" | "failed">(
    "sent",
  );

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setStep("reason");
    setReasonPreset("VIP customer");
    setCustomReason("");
    setError(null);
    setCode("");
    setSentTo("");
    setCodeFirstTwo("");
    setPushSent(0);
    setRequesting(false);
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

  async function handleReasonNext() {
    setError(null);
    const reason = resolveReason();
    if (!reason) return;

    // Owner menyetujui dirinya sendiri — tidak perlu bolak-balik kode.
    if (isOwner) {
      onApproved(reason, null);
      return;
    }

    setRequesting(true);
    const res = await requestComplimentApprovalCode({ reason, subtotal });
    setRequesting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    setSentTo(res.data.ownerEmailMasked);
    setCodeFirstTwo(res.data.codeFirstTwo);
    setEmailMode(res.data.emailMode);
    setPushSent(res.data.pushSent);
    setStep("code");
  }

  async function handleCodeSubmit() {
    if (submitting) return;
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Kode harus 6 digit angka");
      return;
    }
    setSubmitting(true);
    const res = await consumeComplimentApprovalCode(code.trim());
    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    /* Pakai alasan yang DISETUJUI owner, bukan yang masih di layar — supaya
     * yang diterapkan persis yang di-approve. */
    onApproved(res.data.approvedReason, res.data.approvalCodeId);
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
            <Button onClick={handleReasonNext} disabled={requesting}>
              <Gift className="size-4" aria-hidden />
              {requesting
                ? "Mengirim ke Owner…"
                : isOwner
                  ? "Terapkan Compliment"
                  : "Minta Kode Owner"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep("reason")}>
              Kembali
            </Button>
            <Button onClick={handleCodeSubmit} disabled={submitting}>
              {submitting ? "Memeriksa…" : "Approve & Terapkan"}
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
                  : "Compliment butuh kode dari Owner"}
              </p>
              <p className="text-warning-500/90">
                {isOwner
                  ? "Kamu Owner, jadi compliment langsung diterapkan tanpa kode. Tetap tercatat di Audit Log."
                  : "Setelah tap tombol, kode 6 digit dikirim ke Owner lewat email + notifikasi HP. Minta kodenya ke Owner, lalu ketik di layar berikutnya."}
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
          <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
            <div className="flex items-start gap-2">
              <Mail className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {emailMode === "sent" ? (
                  <>
                    Kode dikirim ke <strong>{sentTo}</strong>
                  </>
                ) : emailMode === "logged" ? (
                  <>Email belum dikonfigurasi — kode tercatat di log server.</>
                ) : (
                  <span className="text-danger-500">
                    Email GAGAL terkirim. Minta Owner cek notifikasi HP-nya.
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-start gap-2">
              <Smartphone className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {pushSent > 0
                  ? `Notifikasi terkirim ke ${pushSent} perangkat Owner.`
                  : "Owner belum mengaktifkan notifikasi HP — kode hanya lewat email."}
              </span>
            </div>
            {codeFirstTwo ? (
              <p className="text-neutral-500">
                Kode aktif diawali <strong>{codeFirstTwo}…</strong> — cocokkan
                dengan yang Owner sebutkan.
              </p>
            ) : null}
          </div>

          <Input
            label="Kode Approval dari Owner"
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            inputMode="numeric"
            placeholder="6 digit"
            autoFocus
            className="text-center font-mono text-2xl tracking-[0.4em]"
          />

          {error ? (
            <p className="rounded-md bg-danger-100 p-2 text-sm text-danger-500">
              {error}
            </p>
          ) : null}

          <Button
            variant="ghost"
            size="sm"
            onClick={handleReasonNext}
            disabled={requesting}
            className="w-full"
          >
            {requesting ? "Mengirim ulang…" : "Kirim ulang kode"}
          </Button>
        </div>
      )}
    </Modal>
  );
}
