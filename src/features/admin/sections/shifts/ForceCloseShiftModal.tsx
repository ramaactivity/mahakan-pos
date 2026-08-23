"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, Input, Modal, toast } from "@/components/ui";
import { forceCloseShift, type Shift } from "@/features/shifts";
import { formatIndonesianDateTime } from "@/lib/date";
import { formatRupiah } from "@/lib/format";

/**
 * Audit POS E2E 2026-06-12 — Tutup Paksa shift nginep (owner, backoffice).
 *
 * Owner WAJIB hitung kas fisik laci + isi alasan — variance dihitung jujur
 * (bukan auto-0) dan dijurnal seperti tutup normal. Server tetap memblokir
 * kalau masih ada open bill / approval pending (pesan error diteruskan).
 */
interface Props {
  shift: Shift | null;
  openerName: string | null;
  onClose: () => void;
  onDone: () => void;
}

export function ForceCloseShiftModal({
  shift,
  openerName,
  onClose,
  onDone,
}: Props) {
  const [actualCash, setActualCash] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  /* Reset form per shift target (keyed id primitif — pitfall form-reset). */
  const [initKey, setInitKey] = useState<string | null>(null);
  useEffect(() => {
    if (shift && shift.id !== initKey) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setInitKey(shift.id);
      setActualCash("");
      setReason("");
      setSubmitting(false);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [shift, initKey]);

  if (!shift) return null;

  const parsedCash = Number(actualCash.replace(/[^\d]/g, ""));
  const cashValid = actualCash.trim().length > 0 && Number.isFinite(parsedCash);
  const reasonValid = reason.trim().length >= 3;

  async function submit() {
    if (!shift || submitting || !cashValid || !reasonValid) return;
    setSubmitting(true);
    const res = await forceCloseShift({
      shiftId: shift.id,
      actualCash: parsedCash,
      reason: reason.trim(),
    });
    setSubmitting(false);
    if (!res.success) {
      toast.error(res.error.message);
      return;
    }
    const variance = res.data.shift.variance ?? 0;
    toast.success(
      variance === 0
        ? "Shift ditutup paksa — kas pas"
        : `Shift ditutup paksa — selisih ${variance > 0 ? "+" : "-"}${formatRupiah(Math.abs(variance))}`,
    );
    onDone();
  }

  return (
    <Modal
      open={shift !== null}
      onClose={onClose}
      title="Tutup Paksa Shift"
      description={`Shift ${openerName ?? shift.userId.slice(0, 8)} · buka ${formatIndonesianDateTime(shift.openedAt)}`}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={submitting || !cashValid || !reasonValid}
          >
            {submitting ? "Menutup…" : "Ya, Tutup Paksa"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-md border border-warning-500/35 bg-warning-100/40 p-3 text-xs text-neutral-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-500" />
          <p>
            Pakai ini untuk shift yang lupa ditutup (nginep). Hitung dulu kas
            fisik di laci — selisih akan dihitung & dijurnal jujur seperti
            tutup shift biasa. Kalau masih ada bill belum dibayar atau
            persetujuan pending, server akan menolak (selesaikan dulu).
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-900">
            Kas fisik dihitung (Rp) <span className="text-danger-500">*</span>
          </label>
          <Input
            inputMode="numeric"
            value={actualCash}
            onChange={(e) =>
              setActualCash(e.target.value.replace(/[^\d]/g, ""))
            }
            placeholder={`Kas awal shift: ${formatRupiah(shift.openingCash)}`}
            disabled={submitting}
          />
          {cashValid ? (
            <p className="mt-1 font-mono text-[11px] text-neutral-500">
              = {formatRupiah(parsedCash)}
            </p>
          ) : null}
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-900">
            Alasan <span className="text-danger-500">*</span>
          </label>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 200))}
            placeholder="Mis: kasir lupa tutup shift semalam"
            disabled={submitting}
          />
          {!reasonValid && reason.length > 0 ? (
            <p className="mt-1 text-[11px] text-danger-600">
              Minimal 3 karakter
            </p>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
