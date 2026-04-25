"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal, toast } from "@/components/ui";
import { isOk, userService } from "@/mocks/services";

interface ResetPinModalProps {
  open: boolean;
  userId: string | null;
  userName: string;
  updatedBy: string;
  onClose: () => void;
  onReset: () => void;
}

export function ResetPinModal({
  open,
  userId,
  userName,
  updatedBy,
  onClose,
  onReset,
}: ResetPinModalProps) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const res = await userService.resetPin({
      userId,
      newPin: pin,
      updatedBy,
    });
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
        <Input
          label="PIN Baru (4-6 digit)"
          type="text"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
          autoFocus
          required
        />
        <Input
          label="Konfirmasi PIN"
          type="text"
          inputMode="numeric"
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
