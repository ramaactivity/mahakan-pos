"use client";

import { useState } from "react";
import { AlertTriangle, Mail } from "lucide-react";
import {
  Button,
  Input,
  Modal,
  NumericInput,
  toast,
} from "@/components/ui";
import { requestShiftRebalance } from "@/features/shifts/rebalance-actions";
import { isOk, type Shift } from "@/features/shifts/types";
import { formatRupiah } from "@/lib/format";

interface ShiftRebalanceModalProps {
  open: boolean;
  shift: Shift | null;
  /** Default source — kasir/POS context = 'close_shift', backoffice = 'manager_backoffice'. */
  source?: "close_shift" | "manager_backoffice";
  /** Computed expectedCash dari summary (untuk display Selisih live). */
  expectedCash?: number | null;
  /** POS Actual amounts untuk display reference. */
  posActualQris?: number;
  posActualCardBca?: number;
  onClose: () => void;
  onSubmitted: () => void;
}

/**
 * Sesi AE-62o — Modal kasir/manager request rebalancing shift.
 *
 * Display:
 *  - Per-channel correction fields: Cash + QRIS + EDC
 *  - Each row: Original (readonly) → Corrected (input) → Selisih
 *  - Reason (wajib min 3 char)
 *  - Submit → email code ke owner + toast confirm
 */
export function ShiftRebalanceModal({
  open,
  shift,
  source = "close_shift",
  expectedCash,
  posActualQris = 0,
  posActualCardBca = 0,
  onClose,
  onSubmitted,
}: ShiftRebalanceModalProps) {
  const [correctedCash, setCorrectedCash] = useState("");
  const [correctedQris, setCorrectedQris] = useState("");
  const [correctedEdc, setCorrectedEdc] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    codeFirstTwo: string;
    ownerEmailMasked: string;
    emailMode: "sent" | "logged" | "failed";
  } | null>(null);

  if (!shift) return null;

  // Reset state on open transitions handled by caller via key prop or useEffect — simple reset:
  function resetForm() {
    setCorrectedCash("");
    setCorrectedQris("");
    setCorrectedEdc("");
    setReason("");
    setError(null);
    setSuccess(null);
  }

  function tryParse(s: string): number | null {
    const t = s.trim();
    if (t.length === 0) return null;
    const n = parseInt(t.replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  const cashNum = tryParse(correctedCash);
  const qrisNum = tryParse(correctedQris);
  const edcNum = tryParse(correctedEdc);

  // Default originals (kalau null = belum ada value yang lalu)
  const originalCash = shift.actualCash ?? 0;
  const originalQris = shift.qrisSettlement ?? 0;
  const originalEdc = shift.edcSettlement ?? 0;

  async function onSubmit() {
    if (!shift) return;
    setError(null);
    if (cashNum === null) {
      setError("Cash fisik wajib diisi");
      return;
    }
    if (reason.trim().length < 3) {
      setError("Alasan minimal 3 karakter");
      return;
    }
    setSubmitting(true);
    const res = await requestShiftRebalance({
      shiftId: shift.id,
      source,
      correctedActualCash: cashNum,
      correctedQrisSettlement: qrisNum,
      correctedEdcSettlement: edcNum,
      reason: reason.trim(),
    });
    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    setSuccess({
      codeFirstTwo: res.data.codeFirstTwo,
      ownerEmailMasked: res.data.ownerEmailMasked,
      emailMode: res.data.emailMode,
    });
    toast.success(
      res.data.emailMode === "sent"
        ? `Kode terkirim ke ${res.data.ownerEmailMasked}`
        : res.data.emailMode === "logged"
          ? "Kode di-log (dev mode)"
          : `Email gagal — minta Owner cek pengaturan`,
    );
    onSubmitted();
  }

  // Live selisih displays (corrected - original)
  const cashDiff = cashNum !== null ? cashNum - originalCash : null;
  const qrisDiff = qrisNum !== null ? qrisNum - originalQris : null;
  const edcDiff = edcNum !== null ? edcNum - originalEdc : null;

  return (
    <Modal
      open={open}
      onClose={
        submitting
          ? () => undefined
          : () => {
              resetForm();
              onClose();
            }
      }
      title="Ajukan Rebalancing Shift"
      description={
        success
          ? "Kode terkirim ke Owner. Tunggu approve."
          : "Owner akan terima email berisi kode 6-digit untuk approve correction."
      }
      size="lg"
      footer={
        success ? (
          <Button
            onClick={() => {
              resetForm();
              onClose();
            }}
            size="lg"
          >
            Tutup
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              Batal
            </Button>
            <Button
              onClick={onSubmit}
              loading={submitting}
              disabled={
                cashNum === null || reason.trim().length < 3 || submitting
              }
              size="lg"
              className="!h-12"
            >
              <Mail className="size-4" /> Kirim ke Owner
            </Button>
          </>
        )
      }
    >
      {success ? (
        <div className="space-y-3">
          <div className="rounded-lg border-2 border-mahakan-green-500 bg-mahakan-green-50 p-4 text-center">
            <p className="text-xs uppercase tracking-wider text-mahakan-green-900">
              Kode dimulai dengan
            </p>
            <p className="mt-1 font-mono text-3xl font-bold tracking-widest text-mahakan-green-900">
              {success.codeFirstTwo}**
            </p>
            <p className="mt-2 text-xs text-mahakan-green-900">
              Email lengkap dikirim ke {success.ownerEmailMasked}
            </p>
          </div>
          {success.emailMode === "failed" ? (
            <div className="rounded-md border border-danger-300 bg-danger-100 p-3 text-xs text-danger-700">
              <strong>Email gagal kirim.</strong> Minta Owner cek Pengaturan →
              Email Approval, atau forward kode lewat WhatsApp via Owner.
            </div>
          ) : null}
          <p className="text-xs text-neutral-600">
            Owner buka backoffice → Shifts → Rebalancing → input kode untuk
            approve. Setelah approve, shift fields + journal akan ter-update.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {expectedCash != null ? (
            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
              <strong>Kas Harusnya (sistem):</strong>{" "}
              <span className="font-mono">{formatRupiah(expectedCash)}</span>{" "}
              — selisih dihitung dari (corrected − Kas Harusnya untuk Cash,
              corrected − POS Actual untuk QRIS/EDC).
            </div>
          ) : null}

          <ChannelRow
            label="Kas Fisik (laci)"
            original={originalCash}
            correctedRaw={correctedCash}
            correctedNum={cashNum}
            diff={cashDiff}
            onChange={setCorrectedCash}
            required
          />
          <ChannelRow
            label="QRIS (cek HP/app)"
            original={originalQris}
            posActual={posActualQris}
            correctedRaw={correctedQris}
            correctedNum={qrisNum}
            diff={qrisDiff}
            onChange={setCorrectedQris}
            hint="Kosongkan kalau tidak ada koreksi"
          />
          <ChannelRow
            label="EDC BCA (cek mesin)"
            original={originalEdc}
            posActual={posActualCardBca}
            correctedRaw={correctedEdc}
            correctedNum={edcNum}
            diff={edcDiff}
            onChange={setCorrectedEdc}
            hint="Kosongkan kalau tidak ada koreksi"
          />

          <Input
            label="Alasan correction (wajib, min 3 karakter)"
            placeholder="mis. transaksi 100k harusnya QRIS, kasir keliru ketik Cash"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
          />

          <div className="rounded-md border border-warning-300 bg-warning-100 p-3 text-xs text-warning-700">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                <strong>Setelah Owner approve:</strong> shift fields akan
                di-update + journal variance lama di-reverse + journal baru
                di-post. Tercatat lengkap di audit log dengan reason + approver.
              </span>
            </p>
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-md border border-danger-300 bg-danger-100 p-2 text-sm font-medium text-danger-700"
            >
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function ChannelRow({
  label,
  original,
  posActual,
  correctedRaw,
  correctedNum,
  diff,
  onChange,
  required,
  hint,
}: {
  label: string;
  original: number;
  posActual?: number;
  correctedRaw: string;
  correctedNum: number | null;
  diff: number | null;
  onChange: (v: string) => void;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-neutral-900">
          {label}
          {required ? (
            <span className="ml-1 text-danger-500" aria-hidden>
              *
            </span>
          ) : null}
        </p>
        {posActual != null ? (
          <span
            className="text-[10px] text-neutral-500"
            title="POS Actual = total transaksi POS untuk channel ini"
          >
            POS Actual:{" "}
            <span className="font-mono text-neutral-700">
              {formatRupiah(posActual)}
            </span>
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-neutral-500">
            Lama
          </p>
          <p className="font-mono text-sm text-neutral-700">
            {formatRupiah(original)}
          </p>
        </div>
        <span className="text-neutral-400">→</span>
        <NumericInput
          aria-label={`${label} corrected`}
          placeholder={hint ?? "Input baru"}
          value={correctedRaw}
          onChange={onChange}
          prefix="Rp"
          formatThousands
        />
      </div>
      {diff !== null && correctedNum !== null ? (
        <p
          className={`mt-1 text-right text-xs font-medium ${
            diff === 0
              ? "text-success-500"
              : diff > 0
                ? "text-mahakan-green-700"
                : "text-danger-500"
          }`}
        >
          Selisih: {diff >= 0 ? "+" : ""}
          {formatRupiah(diff)}
        </p>
      ) : null}
    </div>
  );
}
