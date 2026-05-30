"use client";

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { Button, Input, Modal, toast } from "@/components/ui";
import { correctOpeningCash, isOk, type Shift } from "@/features/shifts";
import { useSession } from "@/features/auth/SessionProvider";
import { hasPermission } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/format";
import { ApproverOverrideModal } from "./ApproverOverrideModal";

/**
 * Sesi AE-167 — koreksi kas awal shift (salah input saat buka).
 *
 * Otorisasi: owner/manager langsung; selain itu wajib persetujuan PIN
 * owner/manager (ApproverOverrideModal). Shift buka → tanpa jurnal; shift
 * tutup → server geser variance + reverse/post jurnal (s/d 24:00 WIB).
 *
 * Reusable: dipakai di Tutup Shift (POS) + ShiftDetailModal (back office).
 */
export function CorrectOpeningCashModal({
  open,
  shiftId,
  currentOpeningCash,
  shiftClosed,
  onClose,
  onCorrected,
}: {
  open: boolean;
  shiftId: string;
  currentOpeningCash: number;
  /** true kalau shift sudah ditutup (tampilkan info dampak ke selisih). */
  shiftClosed?: boolean;
  onClose: () => void;
  onCorrected: (shift: Shift) => void;
}) {
  const { session } = useSession();
  const isSupervisor =
    !!session && hasPermission(session.user.role, "shift.opening_cash.correct");

  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [approverOpen, setApproverOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setAmount(String(currentOpeningCash));
    setReason("");
    setSubmitting(false);
    setApproverOpen(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, currentOpeningCash]);

  const parsed = parseInt(amount.replace(/\D/g, "") || "0", 10);
  const delta = parsed - currentOpeningCash;

  function validate(): string | null {
    if (!Number.isFinite(parsed) || parsed < 0) return "Nominal tidak valid";
    if (parsed === currentOpeningCash)
      return "Kas awal sama — ubah dulu nominalnya";
    if (parsed > 99_999_999) return "Nominal terlalu besar";
    if (reason.trim().length < 3)
      return "Alasan koreksi wajib (min 3 karakter)";
    return null;
  }

  async function doCorrect(approverToken?: string) {
    setSubmitting(true);
    const res = await correctOpeningCash({
      shiftId,
      correctedOpeningCash: parsed,
      reason: reason.trim(),
      approverToken: approverToken ?? null,
    });
    setSubmitting(false);
    setApproverOpen(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`Kas awal dikoreksi → ${formatRupiah(parsed)}`);
    onCorrected(res.data);
    onClose();
  }

  function onSubmit() {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    if (isSupervisor) {
      void doCorrect();
    } else {
      /* Staff → butuh approval PIN owner/manager. */
      setApproverOpen(true);
    }
  }

  return (
    <>
      <Modal
        open={open && !approverOpen}
        onClose={onClose}
        title="Koreksi Kas Awal"
        description="Perbaiki kas awal kalau salah input saat buka shift."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              Batal
            </Button>
            <Button onClick={onSubmit} loading={submitting}>
              {isSupervisor ? "Simpan Koreksi" : "Minta Persetujuan"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm">
            <span className="text-neutral-600">Kas awal sekarang</span>
            <span className="font-mono font-semibold text-neutral-900">
              {formatRupiah(currentOpeningCash)}
            </span>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="correct-opening"
              className="block text-xs font-medium text-neutral-900"
            >
              Kas awal yang benar
            </label>
            <div className="relative">
              <Wallet
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400"
                aria-hidden
              />
              <Input
                id="correct-opening"
                type="text"
                inputMode="numeric"
                value={parsed === 0 ? "" : parsed.toLocaleString("id-ID")}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                placeholder="200.000"
                className="pl-9 text-right font-mono text-base"
              />
            </div>
            {delta !== 0 ? (
              <p className="text-[11px] text-neutral-600">
                Perubahan:{" "}
                <span
                  className={
                    delta > 0
                      ? "font-semibold text-mahakan-green-700"
                      : "font-semibold text-danger-500"
                  }
                >
                  {delta > 0 ? "+" : "−"}
                  {formatRupiah(Math.abs(delta))}
                </span>
                {shiftClosed ? (
                  <span className="text-neutral-500">
                    {" "}
                    · selisih kas otomatis disesuaikan{" "}
                    {delta > 0 ? "−" : "+"}
                    {formatRupiah(Math.abs(delta))}
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="correct-reason"
              className="block text-xs font-medium text-neutral-900"
            >
              Alasan koreksi (wajib)
            </label>
            <Input
              id="correct-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="mis. salah ketik pas buka, harusnya 200rb"
            />
          </div>

          {!isSupervisor ? (
            <p className="rounded-md border border-warning-300 bg-warning-100/40 p-2 text-[11px] text-warning-600">
              Koreksi kas awal butuh persetujuan Owner/Manager (PIN). Setelah
              klik, minta Owner/Manager input PIN.
            </p>
          ) : null}
          {shiftClosed ? (
            <p className="text-[10px] text-neutral-500">
              Shift sudah tutup — koreksi hanya bisa di hari yang sama (s/d
              24:00 WIB). Selisih kas &amp; jurnal otomatis disesuaikan.
            </p>
          ) : null}
        </div>
      </Modal>

      <ApproverOverrideModal
        open={approverOpen}
        actionType="shift.opening_cash.correct"
        targetEntityId={shiftId}
        title="Persetujuan Koreksi Kas Awal"
        description="Owner / Manager input PIN untuk menyetujui koreksi kas awal."
        onClose={() => setApproverOpen(false)}
        onVerified={({ token }) => {
          void doCorrect(token);
        }}
      />
    </>
  );
}
