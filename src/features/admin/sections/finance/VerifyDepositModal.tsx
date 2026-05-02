"use client";

import { useState } from "react";
import { Button, Input, Modal, toast } from "@/components/ui";
import {
  rejectCashDeposit,
  verifyCashDeposit,
} from "@/features/finance/actions";
import type { CashDeposit } from "@/features/finance/types";
import { formatRupiah } from "@/lib/money";
import { formatIndonesianDate } from "@/lib/date";

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  deposit: CashDeposit | null;
}

export function VerifyDepositModal({ open, onClose, onChanged, deposit }: Props) {
  const [mode, setMode] = useState<"verify" | "reject">("verify");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!deposit) return null;

  async function onSubmit() {
    if (!deposit) return;
    setSubmitting(true);
    try {
      const res =
        mode === "verify"
          ? await verifyCashDeposit({ id: deposit.id })
          : await rejectCashDeposit({
              id: deposit.id,
              reason: reason.trim(),
            });
      if (res.ok) {
        toast.success(
          mode === "verify" ? "Setoran diverifikasi" : "Setoran ditolak",
        );
        onChanged();
        onClose();
        setReason("");
        setMode("verify");
      } else {
        toast.error(res.error.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      title="Verifikasi Setoran Tunai"
      size="md"
    >
      <div className="space-y-3 text-sm">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt className="text-neutral-500">Tanggal</dt>
          <dd className="font-medium">
            {formatIndonesianDate(deposit.depositDate)}
          </dd>
          <dt className="text-neutral-500">Nominal</dt>
          <dd className="font-semibold text-mahakan-green-900">
            {formatRupiah(deposit.amount)}
          </dd>
          <dt className="text-neutral-500">Bank</dt>
          <dd className="font-medium">{deposit.bankDestination}</dd>
          <dt className="text-neutral-500">Ref</dt>
          <dd>{deposit.referenceNo ?? "—"}</dd>
          <dt className="text-neutral-500">Periode</dt>
          <dd>
            {formatIndonesianDate(deposit.coversFromDate)} →{" "}
            {formatIndonesianDate(deposit.coversToDate)}
          </dd>
          {deposit.photoUrl ? (
            <>
              <dt className="text-neutral-500">Foto Bukti</dt>
              <dd>
                <a
                  href={deposit.photoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-mahakan-green-700 underline"
                >
                  Lihat
                </a>
              </dd>
            </>
          ) : null}
        </dl>

        <div className="border-t border-neutral-200 pt-3">
          <div className="mb-2 flex gap-2">
            <button
              type="button"
              onClick={() => setMode("verify")}
              className={
                mode === "verify"
                  ? "rounded-md bg-mahakan-green-700 px-3 py-1.5 text-xs font-semibold text-white"
                  : "rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700"
              }
            >
              Verifikasi
            </button>
            <button
              type="button"
              onClick={() => setMode("reject")}
              className={
                mode === "reject"
                  ? "rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white"
                  : "rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700"
              }
            >
              Tolak
            </button>
          </div>
          {mode === "reject" ? (
            <Input
              label="Alasan tolak"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              placeholder="Jumlah tidak sesuai, foto tidak jelas, dst"
            />
          ) : (
            <p className="text-xs text-neutral-600">
              Pastikan nominal cocok dengan slip bank / mutasi rekening sebelum
              verifikasi.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          Batal
        </Button>
        <Button
          variant={mode === "reject" ? "outline" : "primary"}
          onClick={onSubmit}
          disabled={
            submitting || (mode === "reject" && reason.trim().length < 3)
          }
        >
          {submitting
            ? "Memproses…"
            : mode === "verify"
              ? "Verifikasi"
              : "Tolak"}
        </Button>
      </div>
    </Modal>
  );
}
