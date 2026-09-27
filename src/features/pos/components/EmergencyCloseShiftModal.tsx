"use client";

import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button, Input, Modal, toast } from "@/components/ui";
import { ApproverOverrideModal } from "./ApproverOverrideModal";
import { forceCloseShift, isOk } from "@/features/shifts";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { useCrewPicker } from "@/features/crew/CrewPicker";

interface Props {
  open: boolean;
  shiftId: string;
  /** true = yang login memang Owner, jadi tidak perlu minta PIN lagi. */
  canForceCloseDirectly: boolean;
  onClose: () => void;
  onClosed: () => void;
}

/**
 * Sesi AE-217 — JALAN DARURAT rem shift.
 *
 * Skenario yang diobati: shift kemarin mengunci POS, tapi kasir yang berjaga
 * hari ini tidak tahu berapa kas fisik shift itu (uangnya sudah disetor, yang
 * buka orang lain, laci sudah dirapikan). Tanpa pintu ini satu outlet bisa
 * berhenti berjualan seharian sampai Owner sempat membuka laptop.
 *
 * Bukan bypass: kas fisik tetap WAJIB diisi (variance jujur, bukan auto-nol),
 * alasan wajib ditulis, dan kalau yang menekan bukan Owner maka PIN Owner
 * wajib — persis gerbang yang sama dengan Tutup Paksa di Back Office. PIN
 * Manager otomatis ditolak server karena `shift.force_close` milik Owner saja.
 */
export function EmergencyCloseShiftModal({
  open,
  shiftId,
  canForceCloseDirectly,
  onClose,
  onClosed,
}: Props) {
  const pickCrew = useCrewPicker();
  const [actualCash, setActualCash] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);

  useEffect(() => {
    if (open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setActualCash("");
    setReason("");
    setError(null);
    setSubmitting(false);
    setPinOpen(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  let parsedCash = -1;
  try {
    parsedCash = parseRupiah(actualCash);
  } catch {
    parsedCash = -1;
  }
  const cashValid = actualCash.trim() !== "" && parsedCash >= 0;
  const reasonValid = reason.trim().length >= 3;
  const formValid = cashValid && reasonValid;

  async function submit(approverToken: string | null) {
    if (!formValid || submitting) return;
    setSubmitting(true);
    setError(null);
    const crew = pickCrew ? await pickCrew("Tutup paksa shift") : undefined;
    if (crew === null) {
      setSubmitting(false);
      return;
    }
    const res = await forceCloseShift({
      shiftId,
      actualCash: parsedCash,
      reason: reason.trim(),
      approverToken,
      crewId: crew?.id,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    toast.success("Shift ditutup paksa. Kasir sudah bisa dipakai lagi.");
    onClosed();
  }

  function onPrimary() {
    if (!formValid) {
      setError(
        !cashValid
          ? "Isi dulu kas yang benar-benar ada di laci (boleh 0)"
          : "Alasan wajib diisi minimal 3 huruf",
      );
      return;
    }
    if (canForceCloseDirectly) {
      void submit(null);
      return;
    }
    setPinOpen(true);
  }

  return (
    <>
      <Modal
        open={open && !pinOpen}
        onClose={onClose}
        title="Tutup Paksa Shift"
        description="Untuk shift yang kasnya sudah tidak bisa dihitung ulang. Butuh Owner."
        size="md"
      >
        <div className="space-y-4">
          <div className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              Isi kas apa adanya — <strong>jangan dikira-kira supaya pas</strong>.
              Selisihnya dicatat sebagai selisih kas dan bisa ditelusuri Owner
              nanti. Angka yang dipaksakan pas justru menghapus jejaknya.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-800">
              Kas yang benar-benar ada di laci
            </label>
            <Input
              inputMode="numeric"
              placeholder="0"
              value={actualCash}
              onChange={(e) => setActualCash(e.target.value)}
            />
            {cashValid ? (
              <p className="mt-1 text-xs text-neutral-500">
                {formatRupiah(parsedCash)}
              </p>
            ) : null}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-800">
              Alasan
            </label>
            <Input
              placeholder="Mis. kas sudah disetor semalam, laci sudah kosong"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button
              size="lg"
              className="sm:flex-1"
              onClick={onPrimary}
              disabled={submitting}
            >
              {submitting
                ? "Menutup…"
                : canForceCloseDirectly
                  ? "Tutup Paksa Sekarang"
                  : "Lanjut — minta PIN Owner"}
            </Button>
            <Button
              size="lg"
              variant="secondary"
              className="sm:flex-1"
              onClick={onClose}
              disabled={submitting}
            >
              Batal
            </Button>
          </div>
        </div>
      </Modal>

      <ApproverOverrideModal
        open={pinOpen}
        actionType="shift.force_close"
        targetEntityId={shiftId}
        title="PIN Owner"
        description="Owner input PIN untuk menutup paksa shift ini."
        onClose={() => setPinOpen(false)}
        onVerified={({ token }) => {
          setPinOpen(false);
          void submit(token);
        }}
      />
    </>
  );
}
