"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Modal,
  PinPad,
  Spinner,
} from "@/components/ui";
import { StaffAvatarGrid } from "@/features/auth/StaffAvatarGrid";
import type { Role } from "@/lib/auth";

interface ApproverUser {
  id: string;
  name: string;
  role: Role;
}

type ApproverActionType =
  | "pos.transaction.void"
  | "pos.transaction.refund"
  | "pos.discount.apply"
  | "shift.opening_cash.correct"
  /* Sesi AE-217 — tutup paksa shift dari layar POS (jalan darurat rem
   * anti-lupa-tutup-shift). Owner-only di server. */
  | "shift.force_close"
  /* Sesi AE-241 — bayar belakangan (owner/manager PIN). */
  | "pos.bill.defer.approve";

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
  /**
   * Sesi AE-229 — jalan keluar ke kode Owner. Diisi hanya saat outlet memakai
   * mode "pin_or_code": manager yang bertugas menyetujui di tempat, dan kalau
   * memang tidak ada manager, kasir masih bisa minta kode ke Owner tanpa
   * keluar-masuk layar.
   */
  onUseOwnerCode?: () => void;
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
  onUseOwnerCode,
}: ApproverOverrideModalProps) {
  const [users, setUsers] = useState<ApproverUser[]>([]);
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
      try {
        const res = await fetch("/api/v1/auth/approvers");
        if (cancelled) return;
        if (res.ok) {
          const json = (await res.json()) as { items: ApproverUser[] };
          setUsers(json.items);
        }
      } catch {
        if (!cancelled) setUsers([]);
      } finally {
        if (!cancelled) setLoadingUsers(false);
      }
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

    const res = await fetch("/api/v1/auth/verify-approver", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approverId: selectedId,
        pin,
        actionType,
        targetEntityId: targetEntityId ?? null,
      }),
    });

    const json = (await res.json().catch(() => null)) as
      | { success: true; data: { approverToken: string; approverId: string } }
      | { success: false; error: { message: string } }
      | null;

    if (!res.ok || !json || !json.success) {
      setError(json && !json.success ? json.error.message : "Verifikasi gagal");
      setShake(true);
      setPin("");
      setTimeout(() => setShake(false), 400);
      setSubmitting(false);
      return;
    }

    onVerified({ approverId: selectedId, token: json.data.approverToken });
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

        {/* Sesi AE-229 — jalan keluar kalau tidak ada manager di tempat.
            Sengaja di bawah dan berupa tautan, bukan tombol setara: jalur
            yang diharapkan adalah PIN manager yang selesai saat itu juga. */}
        {onUseOwnerCode ? (
          <button
            type="button"
            onClick={onUseOwnerCode}
            className="mt-4 w-full rounded-md border border-dashed border-neutral-300 px-3 py-2 text-xs text-neutral-600 transition-colors hover:border-mahakan-green-700 hover:text-mahakan-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
          >
            Tidak ada manager di tempat? Minta kode ke Owner
          </button>
        ) : null}
      </div>
    </Modal>
  );
}
