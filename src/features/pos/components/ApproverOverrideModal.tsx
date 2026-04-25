"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Modal,
  PinPad,
  Spinner,
} from "@/components/ui";
import { StaffAvatarGrid } from "@/features/auth/StaffAvatarGrid";
import { authService, isOk } from "@/mocks/services";
import type { PublicUser } from "@/mocks/types";

type ApproverActionType =
  | "pos.transaction.void"
  | "pos.transaction.refund"
  | "pos.discount.apply";

interface ApproverOverrideModalProps {
  open: boolean;
  actionType: ApproverActionType;
  /** Optional entity-id to scope the token (transactionId, etc). */
  targetEntityId?: string;
  /** Title shown to user. */
  title?: string;
  description?: string;
  onClose: () => void;
  /** Called when verification succeeds. Provides token + approverId. */
  onVerified: (result: { approverId: string; token: string }) => void;
}

const MAX_PIN_LENGTH = 6;

export function ApproverOverrideModal({
  open,
  actionType,
  targetEntityId,
  title = "Butuh Persetujuan",
  description = "Owner / Manager input PIN untuk authorize aksi ini.",
  onClose,
  onVerified,
}: ApproverOverrideModalProps) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (!open) {
      // Reset on close — sync with external trigger
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(null);
      setPin("");
      setError(null);
      return;
    }
    let cancelled = false;
    setLoadingUsers(true);
    async function load() {
      const res = await authService.listApprovers();
      if (cancelled) return;
      if (isOk(res)) setUsers(res.data);
      setLoadingUsers(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function onSubmit() {
    if (!selectedId || pin.length < 4 || submitting) return;
    setSubmitting(true);
    setError(null);

    const res = await authService.verifyApprover({
      approverId: selectedId,
      pin,
      actionType,
      targetEntityId,
    });

    if (!isOk(res)) {
      setError(res.error.message);
      setShake(true);
      setPin("");
      setTimeout(() => setShake(false), 400);
      setSubmitting(false);
      return;
    }

    onVerified({ approverId: selectedId, token: res.data.token });
    setSubmitting(false);
  }

  // Auto-submit at max length
  useEffect(() => {
    if (open && pin.length === MAX_PIN_LENGTH && selectedId && !submitting) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void onSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="md"
    >
      <div className={shake ? "animate-shake" : undefined}>
        {loadingUsers ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner className="size-6 text-mahakan-green-700" />
          </div>
        ) : !selectedId ? (
          <StaffAvatarGrid
            users={users}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setPin("");
              setError(null);
            }}
          />
        ) : (
          <div className="space-y-4">
            <div className="flex justify-center gap-2">
              {Array.from({ length: MAX_PIN_LENGTH }).map((_, i) => (
                <span
                  key={i}
                  className={`size-3 rounded-full transition-colors ${
                    i < pin.length
                      ? "bg-mahakan-green-700"
                      : "bg-neutral-200"
                  }`}
                />
              ))}
            </div>
            <PinPad
              value={pin}
              onChange={(next) => {
                setPin(next);
                if (error) setError(null);
              }}
              maxLength={MAX_PIN_LENGTH}
              disabled={submitting}
            />
            {error ? (
              <p role="alert" className="text-center text-sm font-medium text-danger-500">
                {error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button
                variant="outline"
                fullWidth
                onClick={() => {
                  setSelectedId(null);
                  setPin("");
                  setError(null);
                }}
                disabled={submitting}
              >
                Ganti User
              </Button>
              <Button
                onClick={onSubmit}
                loading={submitting}
                disabled={pin.length < 4}
                fullWidth
              >
                Verifikasi
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
