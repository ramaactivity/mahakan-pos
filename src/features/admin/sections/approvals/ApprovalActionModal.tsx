"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Ban,
  KeyRound,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  Button,
  Input,
  Modal,
  toast,
} from "@/components/ui";
import { approveShiftRebalance } from "@/features/shifts/rebalance-actions";
import { approveTransactionCorrection } from "@/features/transactions/correction-actions";
import { approveEntryChange } from "@/features/cash/entry-change-actions";
import { cancelApproval, directApprove, rejectApproval } from "@/features/approvals";
import type { UnifiedApprovalItem } from "@/features/approvals";

export type ApprovalActionMode =
  | "direct"
  | "code"
  | "reject"
  | "cancel";

export interface ApprovalActionModalProps {
  target: UnifiedApprovalItem | null;
  mode: ApprovalActionMode | null;
  onClose: () => void;
  onChanged: () => void;
}

const MODE_TITLE: Record<ApprovalActionMode, string> = {
  direct: "Approve Langsung (Owner)",
  code: "Input Kode Approval",
  reject: "Tolak Pengajuan",
  cancel: "Batalkan Pengajuan",
};

const KIND_LABEL = {
  void: "Void Transaksi",
  refund: "Refund Transaksi",
  correction: "Koreksi Transaksi",
  rebalance: "Rebalance Shift",
  entry_change: "Edit Catatan",
} as const;

export function ApprovalActionModal({
  target,
  mode,
  onClose,
  onChanged,
}: ApprovalActionModalProps) {
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target && mode) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setCode("");
      setReason("");
      setError(null);
      setSubmitting(false);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [target, mode]);

  if (!target || !mode) return null;

  async function onSubmit() {
    if (!target || !mode) return;
    setError(null);

    if (mode === "direct") {
      setSubmitting(true);
      const res = await directApprove({
        kind: target.kind,
        sourceId: target.sourceId,
      });
      setSubmitting(false);
      if (!res.success) {
        setError(res.error.message);
        return;
      }
      toast.success(`${KIND_LABEL[target.kind]} berhasil di-approve`);
      onChanged();
      return;
    }

    if (mode === "code") {
      if (!/^\d{6}$/.test(code.trim())) {
        setError("Kode harus 6 digit");
        return;
      }
      setSubmitting(true);
      // Per-branch typing supaya TS bisa narrow ApiResult dengan tepat.
      if (target.kind === "rebalance") {
        const res = await approveShiftRebalance({
          rebalanceId: target.sourceId,
          code: code.trim(),
        });
        setSubmitting(false);
        if (!res.success) {
          setError(res.error.message);
          return;
        }
      } else if (target.kind === "correction") {
        const res = await approveTransactionCorrection({
          correctionId: target.sourceId,
          code: code.trim(),
        });
        setSubmitting(false);
        if (!res.success) {
          setError(res.error.message);
          return;
        }
      } else if (target.kind === "entry_change") {
        const res = await approveEntryChange({
          changeId: target.sourceId,
          code: code.trim(),
        });
        setSubmitting(false);
        if (!res.success) {
          setError(res.error.message);
          return;
        }
      } else {
        // void/refund: code-input dari back office tidak supported — kode
        // diketik di POS, owner langsung approve dari sini.
        setSubmitting(false);
        setError(
          "Void/Refund di-approve via direct approve owner atau dari POS.",
        );
        return;
      }
      toast.success(`${KIND_LABEL[target.kind]} berhasil di-approve`);
      onChanged();
      return;
    }

    if (mode === "reject") {
      if (reason.trim().length < 3) {
        setError("Alasan minimal 3 karakter");
        return;
      }
      setSubmitting(true);
      const res = await rejectApproval({
        kind: target.kind,
        sourceId: target.sourceId,
        reason: reason.trim(),
      });
      setSubmitting(false);
      if (!res.success) {
        setError(res.error.message);
        return;
      }
      toast.info("Pengajuan ditolak");
      onChanged();
      return;
    }

    if (mode === "cancel") {
      setSubmitting(true);
      const res = await cancelApproval({
        kind: target.kind,
        sourceId: target.sourceId,
      });
      setSubmitting(false);
      if (!res.success) {
        setError(res.error.message);
        return;
      }
      toast.info("Pengajuan dibatalkan");
      onChanged();
      return;
    }
  }

  return (
    <Modal
      open
      onClose={submitting ? () => undefined : onClose}
      title={MODE_TITLE[mode]}
      description={`${KIND_LABEL[target.kind]} — ${target.subtitle}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            onClick={onSubmit}
            loading={submitting}
            disabled={submitting}
            variant={
              mode === "direct"
                ? "primary"
                : mode === "code"
                  ? "primary"
                  : mode === "reject"
                    ? "destructive"
                    : "outline"
            }
          >
            {mode === "direct" ? (
              <>
                <ShieldCheck className="size-4" /> Approve
              </>
            ) : mode === "code" ? (
              <>
                <KeyRound className="size-4" /> Apply
              </>
            ) : mode === "reject" ? (
              <>
                <XCircle className="size-4" /> Tolak
              </>
            ) : (
              <>
                <Ban className="size-4" /> Batalkan
              </>
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {mode === "direct" ? (
          <>
            <p className="text-neutral-700">
              Owner approve langsung tanpa kode. Aksi langsung diterapkan
              ke shift / pembukuan / status transaksi.
            </p>
            <ImpactWarning kind={target.kind} />
            <p className="rounded-md bg-info-50 px-2 py-1.5 text-[11px] text-info-700">
              Kalau ada kode aktif untuk pengajuan ini, akan otomatis
              di-revoke supaya tidak dipakai lagi.
            </p>
          </>
        ) : mode === "code" ? (
          <>
            <p className="text-xs text-neutral-700">
              Owner kirim kode 6-digit via WA setelah review email. Masukkan
              kode di sini untuk apply.
            </p>
            <Input
              autoFocus
              label="Kode Approval"
              placeholder="123456"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))
              }
              maxLength={6}
              inputMode="numeric"
              pattern="\d{6}"
            />
            <ImpactWarning kind={target.kind} />
          </>
        ) : mode === "reject" ? (
          <>
            <Input
              autoFocus
              label="Alasan tolak (min 3 karakter)"
              placeholder="mis. correction tidak match dengan bukti"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
            <p className="rounded-md bg-danger-50 px-2 py-1.5 text-[11px] text-danger-700">
              Tolak ini akan revoke kode aktif + notify submitter. Submitter
              perlu submit ulang kalau pengajuan tetap dibutuhkan.
            </p>
          </>
        ) : (
          <>
            <p className="text-neutral-700">
              Yakin batalkan pengajuan ini? Kode aktif (kalau ada) akan
              di-revoke supaya tidak bisa di-apply lagi.
            </p>
            <p className="rounded-md bg-warning-50 px-2 py-1.5 text-[11px] text-warning-700">
              Aman dipakai kalau anda sadar pengajuan salah sebelum
              di-approve. Submit ulang kalau perlu.
            </p>
          </>
        )}
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-danger-300 bg-danger-100 p-2 text-sm font-medium text-danger-700"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function ImpactWarning({ kind }: { kind: UnifiedApprovalItem["kind"] }) {
  const map: Record<UnifiedApprovalItem["kind"], string> = {
    void: "Status transaksi → voided, stock + loyalty + promo direstore, journal di-reverse.",
    refund:
      "Status transaksi → refunded, kas keluar entry dibuat, stock + loyalty + promo direstore, journal di-reverse.",
    correction:
      "Payment method / total transaksi di-update, journal lama di-reverse + journal koreksi di-post, loyalty points di-recalc.",
    rebalance:
      "Shift fields ter-update, variance dihitung ulang, journal lama di-reverse + journal baru di-post.",
    entry_change:
      "Catatan pengeluaran/pemasukan akan ter-edit atau ter-hapus sesuai pengajuan.",
  };
  return (
    <div className="rounded-md border border-warning-300 bg-warning-100 p-2 text-xs text-warning-700">
      <p className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>
          <strong>Aksi tidak bisa di-undo.</strong> {map[kind]}
        </span>
      </p>
    </div>
  );
}
