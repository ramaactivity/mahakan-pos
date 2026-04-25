"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, Input, Modal, toast } from "@/components/ui";
import { isOk, openShift } from "@/features/shifts";
import { formatRupiah, parseRupiah } from "@/lib/format";

interface OpenShiftModalProps {
  open: boolean;
  /** Kept for callsite compatibility; the action derives userId from session. */
  userId: string;
  onClose: () => void;
  onOpened: () => void;
}

export function OpenShiftModal({
  open,
  onClose,
  onOpened,
}: OpenShiftModalProps) {
  const [openingCash, setOpeningCash] = useState("100000");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Reset on open
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpeningCash("100000");
    setError(null);
    setSubmitting(false);
  }, [open]);

  let parsed = 0;
  try {
    parsed = parseRupiah(openingCash);
  } catch {
    parsed = 0;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (parsed < 0) {
      setError("Kas awal tidak boleh negatif");
      return;
    }
    setSubmitting(true);
    setError(null);

    const res = await openShift({ openingCash: parsed });
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success(`Shift dibuka — kas awal ${formatRupiah(parsed)}`);
    onOpened();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Buka Shift"
      description="Hitung kas yang ada di laci sekarang dan masukin jumlahnya."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            onClick={(e) => onSubmit(e)}
            loading={submitting}
            disabled={parsed < 0}
            size="lg"
          >
            Mulai Shift
          </Button>
        </>
      }
    >
      <form
        onSubmit={onSubmit}
        className="space-y-3"
        aria-label="Form buka shift"
      >
        <Input
          label="Kas Awal"
          type="text"
          inputMode="numeric"
          value={openingCash}
          onChange={(e) =>
            setOpeningCash(e.target.value.replace(/[^\d]/g, ""))
          }
          hint={`Preview: ${formatRupiah(parsed)}`}
          required
          autoFocus
          disabled={submitting}
        />
        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
