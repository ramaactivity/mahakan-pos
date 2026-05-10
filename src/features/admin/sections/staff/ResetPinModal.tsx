"use client";

import { useEffect, useId, useState } from "react";
import { Button, Input, Modal, toast } from "@/components/ui";
import { isOk, resetPin } from "@/features/users";

interface ResetPinModalProps {
  open: boolean;
  userId: string | null;
  userName: string;
  /** Kept for callsite compat; action derives userId from session. */
  updatedBy: string;
  onClose: () => void;
  onReset: () => void;
}

export function ResetPinModal({
  open,
  userId,
  userName,
  onClose,
  onReset,
}: ResetPinModalProps) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPin("");
    setConfirmPin("");
    setError(null);
    setSubmitting(false);
  }, [open]);

  async function onSubmit() {
    if (submitting || !userId) return;
    if (pin !== confirmPin) {
      setError("PIN konfirmasi tidak cocok");
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await resetPin({ userId, newPin: pin });
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success(`PIN ${userName} di-reset`);
    onReset();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Reset PIN — ${userName}`}
      description="PIN baru menggantikan PIN lama. User harus pakai PIN baru di POS."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            Reset PIN
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* Sesi AE-19 — autoComplete off untuk prevent browser autofill
         * email login user. */}
        <Input
          label="PIN Baru (4-6 digit)"
          type="text"
          inputMode="numeric"
          name={`staff-pin-new-${fieldId}`}
          autoComplete="new-password"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
          autoFocus
          required
        />
        <Input
          label="Konfirmasi PIN"
          type="text"
          inputMode="numeric"
          name={`staff-pin-confirm-${fieldId}`}
          autoComplete="new-password"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          value={confirmPin}
          onChange={(e) =>
            setConfirmPin(e.target.value.replace(/[^\d]/g, "").slice(0, 6))
          }
          required
        />
        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
